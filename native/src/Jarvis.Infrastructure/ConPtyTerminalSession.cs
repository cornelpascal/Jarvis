using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading.Channels;
using Jarvis.Protocol;
using Microsoft.Win32.SafeHandles;

namespace Jarvis.Infrastructure;

public sealed class ConPtyTerminalSession : ITerminalSession
{
    private const uint ExtendedStartupInfoPresent = 0x00080000;
    private const uint ProcThreadAttributePseudoConsole = 0x00020016;
    private const uint Infinite = 0xFFFFFFFF;

    private readonly Channel<TerminalChunk> _output = Channel.CreateBounded<TerminalChunk>(new BoundedChannelOptions(2_048)
    {
        FullMode = BoundedChannelFullMode.DropOldest,
        SingleReader = false,
        SingleWriter = true,
    });
    private readonly CancellationTokenSource _lifetime = new();
    private SafeFileHandle? _inputWrite;
    private SafeFileHandle? _outputRead;
    private FileStream? _inputStream;
    private FileStream? _outputStream;
    private IntPtr _pseudoConsole;
    private IntPtr _processHandle;
    private IntPtr _threadHandle;
    private Task? _outputPump;
    private Task? _waitTask;
    private uint? _exitCode;

    public string Id { get; } = Guid.NewGuid().ToString();
    public bool IsRunning => _processHandle != IntPtr.Zero && WaitForSingleObject(_processHandle, 0) == 0x102;
    public uint? ExitCode => _exitCode;
    public string? CommandLine { get; private set; }

    public Task StartAsync(
        string executable,
        IReadOnlyList<string> arguments,
        string workingDirectory,
        int columns = 120,
        int rows = 32,
        CancellationToken cancellationToken = default)
    {
        if (IsRunning)
        {
            throw new InvalidOperationException("Terminal is already running.");
        }
        ArgumentOutOfRangeException.ThrowIfLessThan(columns, 1);
        ArgumentOutOfRangeException.ThrowIfLessThan(rows, 1);

        // ConPTY duplicates its pipe ends into conhost. None of these handles
        // should be generally inheritable by the client process.
        ThrowIfFalse(CreatePipe(out var pseudoInputRead, out var hostInputWrite, IntPtr.Zero, 0));
        ThrowIfFalse(CreatePipe(out var hostOutputRead, out var pseudoOutputWrite, IntPtr.Zero, 0));
        try
        {
            ThrowIfFailed(CreatePseudoConsole(new Coord((short)columns, (short)rows), pseudoInputRead, pseudoOutputWrite, 0, out _pseudoConsole));
        }
        finally
        {
            CloseHandle(pseudoInputRead);
            CloseHandle(pseudoOutputWrite);
        }

        _inputWrite = new SafeFileHandle(hostInputWrite, ownsHandle: true);
        _outputRead = new SafeFileHandle(hostOutputRead, ownsHandle: true);
        _inputStream = new FileStream(_inputWrite, FileAccess.Write, 4_096, isAsync: false);
        _outputStream = new FileStream(_outputRead, FileAccess.Read, 4_096, isAsync: false);
        // ConPTY requests the host cursor position during startup and blocks
        // input processing until the terminal replies with a CPR sequence.
        _inputStream.Write(Encoding.ASCII.GetBytes("\x1b[1;1R"));
        _inputStream.Flush();

        nuint attributeSize = 0;
        _ = InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref attributeSize);
        var attributeList = Marshal.AllocHGlobal(checked((nint)attributeSize));
        try
        {
            ThrowIfFalse(InitializeProcThreadAttributeList(attributeList, 1, 0, ref attributeSize));
            ThrowIfFalse(UpdateProcThreadAttribute(
                attributeList,
                0,
                (nuint)ProcThreadAttributePseudoConsole,
                _pseudoConsole,
                (nuint)IntPtr.Size,
                IntPtr.Zero,
                IntPtr.Zero));

            var startup = new StartupInfoEx
            {
                StartupInfo = new StartupInfo { Size = Marshal.SizeOf<StartupInfoEx>() },
                AttributeList = attributeList,
            };
            CommandLine = BuildCommandLine(executable, arguments);
            var processSecurity = new SecurityAttributes { Length = Marshal.SizeOf<SecurityAttributes>() };
            var threadSecurity = new SecurityAttributes { Length = Marshal.SizeOf<SecurityAttributes>() };
            ThrowIfFalse(CreateProcess(
                null,
                CommandLine,
                ref processSecurity,
                ref threadSecurity,
                false,
                ExtendedStartupInfoPresent,
                IntPtr.Zero,
                workingDirectory,
                ref startup,
                out var processInformation));
            _processHandle = processInformation.Process;
            _threadHandle = processInformation.Thread;
        }
        finally
        {
            if (attributeList != IntPtr.Zero)
            {
                DeleteProcThreadAttributeList(attributeList);
                Marshal.FreeHGlobal(attributeList);
            }
        }

        var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, _lifetime.Token);
        _outputPump = PumpOutputAsync(_outputStream, linked.Token);
        _waitTask = Task.Run(() =>
        {
            WaitForSingleObject(_processHandle, Infinite);
            if (GetExitCodeProcess(_processHandle, out var code)) _exitCode = code;
            // Conhost can still have final VT bytes buffered after the client
            // process exits. Give the output pump a bounded drain window.
            Thread.Sleep(250);
            var pseudoConsole = Interlocked.Exchange(ref _pseudoConsole, IntPtr.Zero);
            if (pseudoConsole != IntPtr.Zero)
            {
                ClosePseudoConsole(pseudoConsole);
            }
        }, CancellationToken.None);
        return Task.CompletedTask;
    }

    public async Task WriteAsync(string input, CancellationToken cancellationToken = default)
    {
        if (_inputStream is null || _inputWrite is null || _inputWrite.IsInvalid || _inputWrite.IsClosed)
        {
            throw new InvalidOperationException("Terminal is not running.");
        }
        var bytes = Encoding.UTF8.GetBytes(input);
        await _inputStream.WriteAsync(bytes, cancellationToken);
        await _inputStream.FlushAsync(cancellationToken);
    }

    public Task ResizeAsync(int columns, int rows, CancellationToken cancellationToken = default)
    {
        if (_pseudoConsole == IntPtr.Zero)
        {
            throw new InvalidOperationException("Terminal is not running.");
        }
        ThrowIfFailed(ResizePseudoConsole(_pseudoConsole, new Coord((short)columns, (short)rows)));
        return Task.CompletedTask;
    }

    public async IAsyncEnumerable<TerminalChunk> Output([EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        await foreach (var chunk in _output.Reader.ReadAllAsync(cancellationToken))
        {
            yield return chunk;
        }
    }

    private async Task PumpOutputAsync(Stream stream, CancellationToken cancellationToken)
    {
        var buffer = new byte[8_192];
        try
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                var count = await stream.ReadAsync(buffer, cancellationToken);
                if (count == 0)
                {
                    break;
                }
                var content = Encoding.UTF8.GetString(buffer, 0, count);
                await _output.Writer.WriteAsync(new TerminalChunk(Id, "pty", content, DateTimeOffset.UtcNow), cancellationToken);
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
        }
        catch (IOException) when (!IsRunning)
        {
        }
        finally
        {
            _output.Writer.TryComplete();
        }
    }

    public async Task CancelAsync(CancellationToken cancellationToken = default)
    {
        if (_processHandle != IntPtr.Zero && IsRunning)
        {
            _ = TerminateProcess(_processHandle, 1);
            await Task.Run(() => WaitForSingleObject(_processHandle, Infinite), cancellationToken);
        }
    }

    public async ValueTask DisposeAsync()
    {
        _lifetime.Cancel();
        await CancelAsync();
        _inputStream?.Dispose();
        _outputStream?.Dispose();
        _inputWrite?.Dispose();
        _outputRead?.Dispose();
        if (_pseudoConsole != IntPtr.Zero)
        {
            ClosePseudoConsole(_pseudoConsole);
            _pseudoConsole = IntPtr.Zero;
        }
        if (_threadHandle != IntPtr.Zero)
        {
            CloseHandle(_threadHandle);
            _threadHandle = IntPtr.Zero;
        }
        if (_processHandle != IntPtr.Zero)
        {
            CloseHandle(_processHandle);
            _processHandle = IntPtr.Zero;
        }
        if (_outputPump is not null)
        {
            try { await _outputPump; } catch (OperationCanceledException) { }
        }
        if (_waitTask is not null)
        {
            await _waitTask;
        }
        _output.Writer.TryComplete();
        _lifetime.Dispose();
    }

    internal static string BuildCommandLine(string executable, IReadOnlyList<string> arguments) =>
        string.Join(' ', new[] { Quote(executable) }.Concat(arguments.Select(Quote)));

    private static string Quote(string value)
    {
        if (value.Length > 0 && !value.Any(character => char.IsWhiteSpace(character) || character == '"'))
        {
            return value;
        }
        var builder = new StringBuilder("\"");
        var backslashes = 0;
        foreach (var character in value)
        {
            if (character == '\\')
            {
                backslashes++;
                continue;
            }
            if (character == '"')
            {
                builder.Append('\\', backslashes * 2 + 1).Append('"');
                backslashes = 0;
                continue;
            }
            builder.Append('\\', backslashes).Append(character);
            backslashes = 0;
        }
        builder.Append('\\', backslashes * 2).Append('"');
        return builder.ToString();
    }

    private static void ThrowIfFalse(bool success)
    {
        if (!success)
        {
            throw new Win32Exception(Marshal.GetLastWin32Error());
        }
    }

    private static void ThrowIfFailed(int result)
    {
        if (result < 0)
        {
            Marshal.ThrowExceptionForHR(result);
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    private readonly struct Coord
    {
        public readonly short X;
        public readonly short Y;

        public Coord(short x, short y)
        {
            X = x;
            Y = y;
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct SecurityAttributes
    {
        public int Length;
        public IntPtr SecurityDescriptor;
        public int InheritHandle;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct StartupInfo
    {
        public int Size;
        public string? Reserved;
        public string? Desktop;
        public string? Title;
        public int X;
        public int Y;
        public int XSize;
        public int YSize;
        public int XCountChars;
        public int YCountChars;
        public int FillAttribute;
        public int Flags;
        public short ShowWindow;
        public short Reserved2;
        public IntPtr Reserved2Pointer;
        public IntPtr StandardInput;
        public IntPtr StandardOutput;
        public IntPtr StandardError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct StartupInfoEx
    {
        public StartupInfo StartupInfo;
        public IntPtr AttributeList;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessInformation
    {
        public IntPtr Process;
        public IntPtr Thread;
        public int ProcessId;
        public int ThreadId;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CreatePipe(out IntPtr readPipe, out IntPtr writePipe, IntPtr attributes, uint size);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern int CreatePseudoConsole(Coord size, IntPtr input, IntPtr output, uint flags, out IntPtr pseudoConsole);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern int ResizePseudoConsole(IntPtr pseudoConsole, Coord size);

    [DllImport("kernel32.dll")]
    private static extern void ClosePseudoConsole(IntPtr pseudoConsole);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool InitializeProcThreadAttributeList(IntPtr attributeList, int attributeCount, int flags, ref nuint size);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UpdateProcThreadAttribute(IntPtr attributeList, uint flags, nuint attribute, IntPtr value, nuint size, IntPtr previousValue, IntPtr returnSize);

    [DllImport("kernel32.dll")]
    private static extern void DeleteProcThreadAttributeList(IntPtr attributeList);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CreateProcess(
        string? applicationName,
        string commandLine,
        ref SecurityAttributes processAttributes,
        ref SecurityAttributes threadAttributes,
        [MarshalAs(UnmanagedType.Bool)] bool inheritHandles,
        uint creationFlags,
        IntPtr environment,
        string currentDirectory,
        ref StartupInfoEx startupInfo,
        out ProcessInformation processInformation);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool TerminateProcess(IntPtr process, uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);


    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseHandle(IntPtr handle);

}
