using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Threading.Channels;
using Jarvis.Protocol;
using Microsoft.ML.OnnxRuntime;
using Microsoft.ML.OnnxRuntime.Tensors;

namespace Jarvis.Infrastructure;

/// <summary>Native C# port of openWakeWord's streaming ONNX feature pipeline.</summary>
public sealed class OnnxWakeWordDetector : IWakeWordDetector
{
    private const int CadenceSamples = 1_280;
    private const int MelContextSamples = CadenceSamples + 480;
    private const int MelFrames = 76;
    private const int MelBins = 32;
    private const int ClassifierFrames = 16;
    private const int EmbeddingWidth = 96;
    private readonly InferenceSession _melSession;
    private readonly InferenceSession _embeddingSession;
    private readonly InferenceSession _classifierSession;
    private readonly float _threshold;
    private readonly float _profileThreshold;
    private readonly TimeSpan _cooldown;
    private readonly WakeWordProfileStore? _profileStore;
    private readonly Channel<WakeWordDetection> _detections = Channel.CreateBounded<WakeWordDetection>(8);
    private readonly CancellationTokenSource _lifetime = new();
    private readonly Queue<short> _pendingSamples = new();
    private readonly Queue<short> _rawHistory = new();
    private readonly Queue<float[]> _melHistory = new();
    private readonly Queue<float[]> _featureHistory = new();
    private Task? _pump;
    private long _lastDetectionTicks;
    private volatile bool _suppressed;
    private readonly List<float[]> _profileSamples = [];
    private readonly List<float[]> _pendingEnrollmentSamples = [];
    private int _requiredEnrollmentSamples;
    private bool _enrollmentSpeechActive;
    private int _enrollmentSilentCadences;
    private float[]? _latestEnrollmentSignature;
    private float _bestEnrollmentKeywordScore;
    private float _diagnosticKeywordPeak;
    private float _diagnosticProfilePeak = -1f;
    private long _lastDiagnosticTicks;

    public event EventHandler<WakeWordEnrollmentProgress>? EnrollmentProgress;
    public bool IsEnrolled => _profileSamples.Count > 0;
    public bool IsEnrolling => _requiredEnrollmentSamples > 0;

    public OnnxWakeWordDetector(
        string modelDirectory,
        float threshold = 0.5f,
        int cooldownMilliseconds = 5_000,
        string? profilePath = null,
        float profileThreshold = 0.72f)
    {
        var melPath = Path.Combine(modelDirectory, "melspectrogram.onnx");
        var embeddingPath = Path.Combine(modelDirectory, "embedding_model.onnx");
        var classifierPath = Path.Combine(modelDirectory, "hey_jarvis_v0.1.onnx");
        foreach (var path in new[] { melPath, embeddingPath, classifierPath })
        {
            if (!File.Exists(path)) throw new FileNotFoundException("The native openWakeWord ONNX bundle is incomplete.", path);
        }
        _melSession = CreateSession(melPath);
        _embeddingSession = CreateSession(embeddingPath);
        _classifierSession = CreateSession(classifierPath);
        _threshold = threshold;
        _profileThreshold = profileThreshold;
        _cooldown = TimeSpan.FromMilliseconds(cooldownMilliseconds);
        _profileStore = string.IsNullOrWhiteSpace(profilePath) ? null : new WakeWordProfileStore(profilePath);
        for (var index = 0; index < MelFrames; index++) _melHistory.Enqueue(Enumerable.Repeat(1f, MelBins).ToArray());
        for (var index = 0; index < ClassifierFrames; index++) _featureHistory.Enqueue(new float[EmbeddingWidth]);
    }

    private static InferenceSession CreateSession(string path) => new(path, new SessionOptions
    {
        GraphOptimizationLevel = GraphOptimizationLevel.ORT_ENABLE_ALL,
        InterOpNumThreads = 1,
        IntraOpNumThreads = 1,
    });

    public async Task StartAsync(IAsyncEnumerable<AudioFrame> frames, CancellationToken cancellationToken = default)
    {
        if (_pump is not null) return;
        if (_profileStore is not null && await _profileStore.LoadAsync(cancellationToken) is { } profile)
        {
            _profileSamples.Clear();
            _profileSamples.AddRange(profile.Samples.Where(IsValidProfileSample).Select(Normalize));
        }
        var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, _lifetime.Token);
        _pump = PumpAsync(frames, linked.Token);
    }

    private async Task PumpAsync(IAsyncEnumerable<AudioFrame> frames, CancellationToken cancellationToken)
    {
        await foreach (var frame in frames.WithCancellation(cancellationToken))
        {
            if (frame.Channels != 1 || frame.SampleRate <= 0) continue;
            var input = MemoryMarshal.Cast<byte, short>(frame.Pcm16.Span);
            var samples = frame.SampleRate == 16_000
                ? input.ToArray()
                : ResampleTo16Khz(input, frame.SampleRate);
            foreach (var sample in samples) _pendingSamples.Enqueue(sample);
            while (_pendingSamples.Count >= CadenceSamples)
            {
                for (var index = 0; index < CadenceSamples; index++)
                {
                    _rawHistory.Enqueue(_pendingSamples.Dequeue());
                    while (_rawHistory.Count > 160_000) _rawHistory.Dequeue();
                }
                var keywordScore = PredictCadence();
                if (_suppressed) continue;
                var now = DateTimeOffset.UtcNow;
                var lastTicks = Interlocked.Read(ref _lastDetectionTicks);
                var signature = CurrentSignature();
                if (IsEnrolling)
                {
                    await ProcessEnrollmentCadenceAsync(CadenceRms(), keywordScore, signature, cancellationToken);
                    continue;
                }

                var profileScore = BestProfileSimilarity(signature, _profileSamples);
                LogScorePeaks(keywordScore, profileScore, now);
                if (keywordScore < _threshold) continue;
                if (lastTicks != 0 && now - new DateTimeOffset(lastTicks, TimeSpan.Zero) < _cooldown) continue;
                if (profileScore >= _profileThreshold)
                {
                    Interlocked.Exchange(ref _lastDetectionTicks, now.UtcTicks);
                    JarvisLog.Write("info", "voice.wake.detected",
                        $"keyword={keywordScore:0.000}; profile={profileScore:0.000}");
                    _detections.Writer.TryWrite(new WakeWordDetection("hey jarvis", profileScore, now));
                }
            }
        }
    }

    internal static short[] ResampleTo16Khz(ReadOnlySpan<short> input, int inputSampleRate)
    {
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(inputSampleRate);
        if (input.IsEmpty) return [];
        if (inputSampleRate == 16_000) return input.ToArray();

        var outputLength = checked((int)Math.Round(input.Length * (16_000d / inputSampleRate)));
        var output = new short[outputLength];
        var sourceStep = inputSampleRate / 16_000d;
        for (var outputIndex = 0; outputIndex < output.Length; outputIndex++)
        {
            var sourcePosition = outputIndex * sourceStep;
            var lowerIndex = Math.Min((int)sourcePosition, input.Length - 1);
            var upperIndex = Math.Min(lowerIndex + 1, input.Length - 1);
            var fraction = sourcePosition - lowerIndex;
            var interpolated = input[lowerIndex] + ((input[upperIndex] - input[lowerIndex]) * fraction);
            output[outputIndex] = (short)Math.Clamp(Math.Round(interpolated), short.MinValue, short.MaxValue);
        }
        return output;
    }

    private float PredictCadence()
    {
        var context = new float[MelContextSamples];
        var samples = _rawHistory.TakeLast(MelContextSamples).ToArray();
        var offset = context.Length - samples.Length;
        for (var index = 0; index < samples.Length; index++) context[offset + index] = samples[index];

        var melInputName = _melSession.InputMetadata.Single().Key;
        using (var outputs = _melSession.Run([NamedOnnxValue.CreateFromTensor(melInputName, new DenseTensor<float>(context, [1, context.Length]))]))
        {
            var mel = outputs.First().AsTensor<float>().ToArray();
            for (var start = 0; start + MelBins <= mel.Length; start += MelBins)
            {
                var row = new float[MelBins];
                for (var bin = 0; bin < MelBins; bin++) row[bin] = mel[start + bin] / 10f + 2f;
                _melHistory.Enqueue(row);
            }
        }
        while (_melHistory.Count > 970) _melHistory.Dequeue();

        var recentMel = _melHistory.TakeLast(MelFrames).ToArray();
        var embeddingValues = new float[MelFrames * MelBins];
        for (var row = 0; row < MelFrames; row++) recentMel[row].CopyTo(embeddingValues, row * MelBins);
        var embeddingInputName = _embeddingSession.InputMetadata.Single().Key;
        using (var outputs = _embeddingSession.Run([NamedOnnxValue.CreateFromTensor(embeddingInputName, new DenseTensor<float>(embeddingValues, [1, MelFrames, MelBins, 1]))]))
        {
            _featureHistory.Enqueue(outputs.First().AsTensor<float>().ToArray().TakeLast(EmbeddingWidth).ToArray());
        }
        while (_featureHistory.Count > 120) _featureHistory.Dequeue();

        var recentFeatures = _featureHistory.TakeLast(ClassifierFrames).ToArray();
        var classifierValues = new float[ClassifierFrames * EmbeddingWidth];
        for (var row = 0; row < ClassifierFrames; row++) recentFeatures[row].CopyTo(classifierValues, row * EmbeddingWidth);
        var classifierInputName = _classifierSession.InputMetadata.Single().Key;
        using var classifierOutputs = _classifierSession.Run([NamedOnnxValue.CreateFromTensor(classifierInputName, new DenseTensor<float>(classifierValues, [1, ClassifierFrames, EmbeddingWidth]))]);
        return classifierOutputs.SelectMany(value => value.AsEnumerable<float>()).DefaultIfEmpty().Max();
    }

    private float[] CurrentSignature()
    {
        var values = _featureHistory.TakeLast(ClassifierFrames).SelectMany(value => value).ToArray();
        return Normalize(values);
    }

    private float CadenceRms()
    {
        var samples = _rawHistory.TakeLast(CadenceSamples);
        double energy = 0;
        var count = 0;
        foreach (var sample in samples)
        {
            var normalized = sample / 32768d;
            energy += normalized * normalized;
            count++;
        }
        return count == 0 ? 0 : (float)Math.Sqrt(energy / count);
    }

    private async Task ProcessEnrollmentCadenceAsync(float rms, float keywordScore, float[] signature, CancellationToken cancellationToken)
    {
        const float speechThreshold = 0.015f;
        const int endingSilenceCadences = 3;
        if (rms >= speechThreshold)
        {
            _enrollmentSpeechActive = true;
            _enrollmentSilentCadences = 0;
            if (_latestEnrollmentSignature is null || keywordScore >= _bestEnrollmentKeywordScore)
            {
                _bestEnrollmentKeywordScore = keywordScore;
                _latestEnrollmentSignature = signature;
            }
            return;
        }
        if (!_enrollmentSpeechActive || ++_enrollmentSilentCadences < endingSilenceCadences) return;

        _enrollmentSpeechActive = false;
        _enrollmentSilentCadences = 0;
        if (_latestEnrollmentSignature is null) return;
        _pendingEnrollmentSamples.Add(_latestEnrollmentSignature);
        _latestEnrollmentSignature = null;
        _bestEnrollmentKeywordScore = 0;
        var complete = _pendingEnrollmentSamples.Count >= _requiredEnrollmentSamples;
        EnrollmentProgress?.Invoke(this, new WakeWordEnrollmentProgress(
            _pendingEnrollmentSamples.Count, _requiredEnrollmentSamples, complete));
        if (!complete) return;

        _profileSamples.Clear();
        _profileSamples.AddRange(_pendingEnrollmentSamples);
        _requiredEnrollmentSamples = 0;
        if (_profileStore is not null)
        {
            await _profileStore.SaveAsync(_profileSamples, cancellationToken);
        }
    }

    private void LogScorePeaks(float keywordScore, float profileScore, DateTimeOffset now)
    {
        _diagnosticKeywordPeak = Math.Max(_diagnosticKeywordPeak, keywordScore);
        _diagnosticProfilePeak = Math.Max(_diagnosticProfilePeak, profileScore);
        var previous = Interlocked.Read(ref _lastDiagnosticTicks);
        if (previous != 0 && now.UtcTicks - previous < TimeSpan.TicksPerSecond * 2) return;
        Interlocked.Exchange(ref _lastDiagnosticTicks, now.UtcTicks);
        JarvisLog.Write("info", "voice.wake.scores",
            $"keywordPeak={_diagnosticKeywordPeak:0.000}; profilePeak={_diagnosticProfilePeak:0.000}; " +
            $"keywordThreshold={_threshold:0.000}; profileThreshold={_profileThreshold:0.000}");
        _diagnosticKeywordPeak = 0;
        _diagnosticProfilePeak = -1;
    }

    internal static float BestProfileSimilarity(float[] signature, IEnumerable<float[]> samples) =>
        samples.Where(sample => sample.Length == signature.Length)
            .Select(sample => CenteredCosineSimilarity(signature, sample))
            .DefaultIfEmpty(-1f)
            .Max();

    internal static float CenteredCosineSimilarity(ReadOnlySpan<float> left, ReadOnlySpan<float> right)
    {
        if (left.Length != right.Length || left.IsEmpty) return -1f;
        var leftMean = 0d;
        var rightMean = 0d;
        for (var index = 0; index < left.Length; index++)
        {
            leftMean += left[index];
            rightMean += right[index];
        }
        leftMean /= left.Length;
        rightMean /= right.Length;
        double dot = 0;
        double leftMagnitude = 0;
        double rightMagnitude = 0;
        for (var index = 0; index < left.Length; index++)
        {
            var leftValue = left[index] - leftMean;
            var rightValue = right[index] - rightMean;
            dot += leftValue * rightValue;
            leftMagnitude += leftValue * leftValue;
            rightMagnitude += rightValue * rightValue;
        }
        if (leftMagnitude == 0 || rightMagnitude == 0) return -1f;
        return (float)(dot / Math.Sqrt(leftMagnitude * rightMagnitude));
    }

    internal static float CosineSimilarity(ReadOnlySpan<float> left, ReadOnlySpan<float> right)
    {
        if (left.Length != right.Length || left.IsEmpty) return -1f;
        double dot = 0;
        double leftMagnitude = 0;
        double rightMagnitude = 0;
        for (var index = 0; index < left.Length; index++)
        {
            dot += left[index] * right[index];
            leftMagnitude += left[index] * left[index];
            rightMagnitude += right[index] * right[index];
        }
        if (leftMagnitude == 0 || rightMagnitude == 0) return -1f;
        return (float)(dot / Math.Sqrt(leftMagnitude * rightMagnitude));
    }

    private static float[] Normalize(float[] values)
    {
        var magnitude = Math.Sqrt(values.Sum(value => value * value));
        return magnitude == 0 ? values : values.Select(value => (float)(value / magnitude)).ToArray();
    }

    private static bool IsValidProfileSample(float[] sample) =>
        sample.Length == ClassifierFrames * EmbeddingWidth && sample.All(float.IsFinite);

    public Task BeginEnrollmentAsync(int requiredSamples = 8, CancellationToken cancellationToken = default)
    {
        ObjectDisposedException.ThrowIf(_lifetime.IsCancellationRequested, this);
        if (requiredSamples is < 3 or > 32) throw new ArgumentOutOfRangeException(nameof(requiredSamples));
        cancellationToken.ThrowIfCancellationRequested();
        _pendingEnrollmentSamples.Clear();
        _requiredEnrollmentSamples = requiredSamples;
        _enrollmentSpeechActive = false;
        _enrollmentSilentCadences = 0;
        _latestEnrollmentSignature = null;
        _bestEnrollmentKeywordScore = 0;
        Interlocked.Exchange(ref _lastDetectionTicks, 0);
        EnrollmentProgress?.Invoke(this, new WakeWordEnrollmentProgress(0, requiredSamples, false));
        return Task.CompletedTask;
    }

    public async IAsyncEnumerable<WakeWordDetection> Detections([EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        await foreach (var value in _detections.Reader.ReadAllAsync(cancellationToken)) yield return value;
    }

    public void SetSuppressed(bool suppressed) => _suppressed = suppressed;

    public async Task StopAsync(CancellationToken cancellationToken = default)
    {
        _lifetime.Cancel();
        if (_pump is not null)
        {
            try { await _pump.WaitAsync(cancellationToken); } catch (OperationCanceledException) { }
            _pump = null;
        }
    }

    public async ValueTask DisposeAsync()
    {
        await StopAsync();
        _detections.Writer.TryComplete();
        _melSession.Dispose();
        _embeddingSession.Dispose();
        _classifierSession.Dispose();
        _lifetime.Dispose();
    }
}
