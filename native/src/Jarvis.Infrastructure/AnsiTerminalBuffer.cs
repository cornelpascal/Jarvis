using System.Text;

namespace Jarvis.Infrastructure;

/// <summary>
/// Incrementally projects a VT stream into safe display text. Escape sequences
/// may span chunks, so parser state is retained between app-server reads.
/// </summary>
public sealed class AnsiTerminalBuffer
{
    private readonly int _maximumCharacters;
    private readonly StringBuilder _text = new();
    private ParserState _state;

    public AnsiTerminalBuffer(int maximumCharacters = 200_000)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(maximumCharacters, 1);
        _maximumCharacters = maximumCharacters;
    }

    public string Text => _text.ToString();

    public string Append(string chunk)
    {
        var visible = new StringBuilder(chunk.Length);
        foreach (var character in chunk)
        {
            switch (_state)
            {
                case ParserState.Text when character == '\x1b':
                    _state = ParserState.Escape;
                    break;
                case ParserState.Text:
                    if (character == '\b')
                    {
                        if (_text.Length > 0) _text.Length--;
                        if (visible.Length > 0) visible.Length--;
                    }
                    else if (character != '\0' && character != '\r')
                    {
                        _text.Append(character);
                        visible.Append(character);
                    }
                    break;
                case ParserState.Escape when character == '[':
                    _state = ParserState.ControlSequence;
                    break;
                case ParserState.Escape when character == ']':
                    _state = ParserState.OperatingSystemCommand;
                    break;
                case ParserState.Escape:
                    _state = ParserState.Text;
                    break;
                case ParserState.ControlSequence:
                    // A CSI ends with a byte in the ECMA-48 final-byte range.
                    if (character is >= '@' and <= '~') _state = ParserState.Text;
                    break;
                case ParserState.OperatingSystemCommand when character == '\a':
                    _state = ParserState.Text;
                    break;
                case ParserState.OperatingSystemCommand when character == '\x1b':
                    _state = ParserState.OperatingSystemCommandEscape;
                    break;
                case ParserState.OperatingSystemCommandEscape:
                    _state = character == '\\' ? ParserState.Text : ParserState.OperatingSystemCommand;
                    break;
            }
        }

        if (_text.Length > _maximumCharacters)
        {
            _text.Remove(0, _text.Length - _maximumCharacters);
        }
        return visible.ToString();
    }

    private enum ParserState
    {
        Text,
        Escape,
        ControlSequence,
        OperatingSystemCommand,
        OperatingSystemCommandEscape,
    }
}
