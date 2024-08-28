const { marked } = require('marked');

marked.setOptions({ breaks: true, smartyPants: true });

class J2M {
    /**
     * Converts a Markdown string into HTML (just a wrapper to Marked's parse method).
     *
     * @static
     * @param {string} str - String to convert from Markdown to HTML
     * @returns {string} The HTML result
     */
    static md_to_html(str) {
        return marked.parse(str);
    }

    /**
     * Converts a Jira Wiki string into HTML.
     *
     * @static
     * @param {string} str - String to convert from Jira Wiki syntax to HTML
     * @returns {string} The HTML result
     */
    static jira_to_html(str) {
        return marked.parse(J2M.to_markdown(str));
    }

    /**
     * Converts a Jira Wiki string into Markdown.
     *
     * @static
     * @param {string} str - Jira Wiki string to convert to Markdown
     * @returns {string} The Markdown result
     */
    static to_markdown(str) {
        return (
            str
                // Un-Ordered Lists
                .replace(/^[ \t]*(\*+)\s+/gm, (match, stars) => {
                    return `${Array(stars.length).join('  ')}* `;
                })
                // Ordered lists
                .replace(/^[ \t]*(#+)\s+/gm, (match, nums) => {
                    return `${Array(nums.length).join('   ')}1. `;
                })
                // Headers 1-6
                .replace(/^h([0-6])\.(.*)$/gm, (match, level, content) => {
                    return Array(parseInt(level, 10) + 1).join('#') + content;
                })
                // Bold
                .replace(/\*(\S.*)\*/g, '**$1**')
                // Italic
                .replace(/_(\S.*)_/g, '*$1*')
                // Monospaced text
                .replace(/\{\{([^}]+)\}\}/g, '`$1`')
                // Citations (buggy)
                // .replace(/\?\?((?:.[^?]|[^?].)+)\?\?/g, '<cite>$1</cite>')
                // Inserts
                .replace(/\+([^+]*)\+/g, '<ins>$1</ins>')
                // Superscript
                .replace(/\^([^^]*)\^/g, '<sup>$1</sup>')
                // Subscript
                .replace(/~([^~]*)~/g, '<sub>$1</sub>')
                // Strikethrough
                .replace(/(\s+)-(\S+.*?\S)-(\s+)/g, '$1~~$2~~$3')
                // Code Block
                .replace(
                    /\{code(:([a-z]+))?([:|]?(title|borderStyle|borderColor|borderWidth|bgColor|titleBGColor)=.+?)*\}([^]*?)\n?\{code\}/gm,
                    '```$2$5\n```'
                )
                // Pre-formatted text
                .replace(/{noformat}/g, '```')
                // Un-named Links
                .replace(/\[([^|]+?)\]/g, '<$1>')
                // Images
                .replace(/!(.+)!/g, '![]($1)')
                // Named Links
                .replace(/\[(.+?)\|(.+?)\]/g, '[$1]($2)')
                // Single Paragraph Blockquote
                .replace(/^bq\.\s+/gm, '> ')
                // Remove color: unsupported in md
                .replace(/\{color:[^}]+\}([^]*?)\{color\}/gm, '$1')
                // panel into table
                .replace(/\{panel:title=([^}]*)\}\n?([^]*?)\n?\{panel\}/gm, '\n| $1 |\n| --- |\n| $2 |')
                // table header
                .replace(/^[ \t]*((?:\|\|.*?)+\|\|)[ \t]*$/gm, (match, headers) => {
                    const singleBarred = headers.replace(/\|\|/g, '|');
                    return `\n${singleBarred}\n${singleBarred.replace(/\|[^|]+/g, '| --- ')}`;
                })
                // remove leading-space of table headers and rows
                .replace(/^[ \t]*\|/gm, '|')
        );
        // // remove unterminated inserts across table cells
        // .replace(/\|([^<]*)<ins>(?![^|]*<\/ins>)([^|]*)\|/g, (_, preceding, following) => {
        //     return `|${preceding}+${following}|`;
        // })
        // // remove unopened inserts across table cells
        // .replace(/\|(?<![^|]*<ins>)([^<]*)<\/ins>([^|]*)\|/g, (_, preceding, following) => {
        //     return `|${preceding}+${following}|`;
        // });
    }

    /**
     * Converts a Markdown string into Jira Wiki syntax.
     *
     * @static
     * @param {string} str - Markdown string to convert to Jira Wiki syntax
     * @returns {string} The Jira Wiki syntax result
     */
    static to_jira(str) {
        const map = {
            // cite: '??',
            del: '-',
            ins: '+',
            sup: '^',
            sub: '~',
        };

        return (
            str
                // Tables
                .replace(
                    /^\n((?:\|.*?)+\|)[ \t]*\n((?:\|\s*?-{3,}\s*?)+\|)[ \t]*\n((?:(?:\|.*?)+\|[ \t]*\n)*)$/gm,
                    (match, headerLine, separatorLine, rowstr) => {
                        const headers = headerLine.match(/[^|]+(?=\|)/g);
                        const separators = separatorLine.match(/[^|]+(?=\|)/g);
                        if (headers.length !== separators.length) return match;

                        const rows = rowstr.split('\n');
                        if (rows.length === 2 && headers.length === 1)
                            // Panel
                            return `{panel:title=${headers[0].trim()}}\n${rowstr
                                .replace(/^\|(.*)[ \t]*\|/, '$1')
                                .trim()}\n{panel}\n`;

                        return `||${headers.join('||')}||\n${rowstr}`;
                    }
                )
                // Bold, Italic, and Combined (bold+italic)
                .replace(/([*_]+)(\S.*?)\1/g, (match, wrapper, content) => {
                    switch (wrapper.length) {
                        case 1:
                            return `_${content}_`;
                        case 2:
                            return `*${content}*`;
                        case 3:
                            return `_*${content}*_`;
                        default:
                            return wrapper + content + wrapper;
                    }
                })
                // All Headers (# format)
                .replace(/^([#]+)(.*?)$/gm, (match, level, content) => {
                    return `h${level.length}.${content}`;
                })
                // Headers (H1 and H2 underlines)
                .replace(/^(.*?)\n([=-]+)$/gm, (match, content, level) => {
                    return `h${level[0] === '=' ? 1 : 2}. ${content}`;
                })
                // Ordered lists
                .replace(/^([ \t]*)\d+\.\s+/gm, (match, spaces) => {
                    return `${Array(Math.floor(spaces.length / 3) + 1)
                        .fill('#')
                        .join('')} `;
                })
                // Un-Ordered Lists
                .replace(/^([ \t]*)\*\s+/gm, (match, spaces) => {
                    return `${Array(Math.floor(spaces.length / 2 + 1))
                        .fill('*')
                        .join('')} `;
                })
                // Headers (h1 or h2) (lines "underlined" by ---- or =====)
                // Citations, Inserts, Subscripts, Superscripts, and Strikethroughs
                .replace(new RegExp(`<(${Object.keys(map).join('|')})>(.*?)</\\1>`, 'g'), (match, from, content) => {
                    const to = map[from];
                    return to + content + to;
                })
                // Other kind of strikethrough
                .replace(/(\s+)~~(.*?)~~(\s+)/g, '$1-$2-$3')
                // Named/Un-Named Code Block
                .replace(/```(.+\n)?((?:.|\n)*?)```/g, (match, synt, content) => {
                    let code = '{code}';
                    if (synt) {
                        code = `{code:${synt.replace(/\n/g, '')}}\n`;
                    }
                    return `${code}${content}{code}`;
                })
                // Inline-Preformatted Text
                .replace(/`([^`]+)`/g, '{{$1}}')
                // Images
                .replace(/!\[[^\]]*\]\(([^)]+)\)/g, '!$1!')
                // Named Link
                .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '[$1|$2]')
                // Un-Named Link
                .replace(/<([^>]+)>/g, '[$1]')
                // Single Paragraph Blockquote
                .replace(/^>/gm, 'bq.')
        );
    }
}

module.exports = J2M;
