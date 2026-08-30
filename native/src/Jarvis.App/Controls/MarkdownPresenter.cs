using Markdig;
using Markdig.Syntax;
using Markdig.Syntax.Inlines;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Documents;
using Microsoft.UI.Xaml.Media;

namespace Jarvis.App.Controls;

public sealed class MarkdownPresenter : StackPanel
{
    private static readonly MarkdownPipeline Pipeline = new MarkdownPipelineBuilder().UseAdvancedExtensions().Build();

    public static readonly DependencyProperty MarkdownProperty = DependencyProperty.Register(
        nameof(Markdown), typeof(string), typeof(MarkdownPresenter), new PropertyMetadata(string.Empty, MarkdownChanged));

    public string Markdown
    {
        get => (string)GetValue(MarkdownProperty);
        set => SetValue(MarkdownProperty, value);
    }

    private static void MarkdownChanged(DependencyObject dependencyObject, DependencyPropertyChangedEventArgs args) =>
        ((MarkdownPresenter)dependencyObject).Render(args.NewValue as string ?? string.Empty);

    private void Render(string markdown)
    {
        Children.Clear();
        var document = Markdig.Markdown.Parse(markdown, Pipeline);
        foreach (var block in document)
        {
            switch (block)
            {
                case FencedCodeBlock code:
                    Children.Add(new TextBox
                    {
                        Text = string.Join(Environment.NewLine, code.Lines.Lines.Select(line => line.Slice.ToString())),
                        FontFamily = new FontFamily("Cascadia Mono"),
                        FontSize = 11,
                        IsReadOnly = true,
                        AcceptsReturn = true,
                        TextWrapping = TextWrapping.NoWrap,
                        Margin = new Thickness(0, 4, 0, 4),
                    });
                    break;
                case HeadingBlock heading:
                    Children.Add(CreateRichText(heading.Inline, Math.Max(14, 24 - heading.Level * 2), true));
                    break;
                case ParagraphBlock paragraph:
                    Children.Add(CreateRichText(paragraph.Inline, 13, false));
                    break;
                default:
                    Children.Add(new TextBlock { Text = block.ToString(), TextWrapping = TextWrapping.Wrap });
                    break;
            }
        }
    }

    private static RichTextBlock CreateRichText(ContainerInline? inline, double size, bool bold)
    {
        var paragraph = new Paragraph();
        if (inline is not null)
        {
            AppendInlines(paragraph.Inlines, inline);
        }
        if (bold)
        {
            paragraph.FontWeight = Microsoft.UI.Text.FontWeights.SemiBold;
        }
        return new RichTextBlock { FontSize = size, TextWrapping = TextWrapping.Wrap, Blocks = { paragraph } };
    }

    private static void AppendInlines(InlineCollection target, ContainerInline source)
    {
        foreach (var child in source)
        {
            switch (child)
            {
                case LiteralInline literal:
                    target.Add(new Run { Text = literal.Content.ToString() });
                    break;
                case CodeInline code:
                    target.Add(new Run { Text = code.Content, FontFamily = new FontFamily("Cascadia Mono") });
                    break;
                case LineBreakInline:
                    target.Add(new LineBreak());
                    break;
                case EmphasisInline emphasis:
                    var emphasisSpan = new Span();
                    if (emphasis.DelimiterCount >= 2)
                    {
                        emphasisSpan.FontWeight = Microsoft.UI.Text.FontWeights.SemiBold;
                    }
                    else
                    {
                        emphasisSpan.FontStyle = Windows.UI.Text.FontStyle.Italic;
                    }
                    AppendInlines(emphasisSpan.Inlines, emphasis);
                    target.Add(emphasisSpan);
                    break;
                case ContainerInline container:
                    var span = new Span();
                    AppendInlines(span.Inlines, container);
                    target.Add(span);
                    break;
                default:
                    target.Add(new Run { Text = child.ToString() ?? string.Empty });
                    break;
            }
        }
    }
}
