const should = require('chai').should();
const fs = require('fs');
const path = require('path');

const j2m = require('../index');

describe('to_markdown', () => {
    it('should exist', () => {
        should.exist(j2m.to_markdown);
    });
    it('should be a function', () => {
        j2m.to_markdown.should.be.a('function');
    });
    it('should convert bolds properly', () => {
        const markdown = j2m.to_markdown('*bold*');
        markdown.should.eql('**bold**');
    });
    it('should convert italics properly', () => {
        const markdown = j2m.to_markdown('_italic_');
        markdown.should.eql('*italic*');
    });
    it('should convert monospaced content properly', () => {
        const markdown = j2m.to_markdown('{{monospaced}}');
        markdown.should.eql('`monospaced`');
    });
    // it('should convert citations properly', () => {
    //     const markdown = j2m.to_markdown('??citation??');
    //     markdown.should.eql('<cite>citation</cite>');
    // });
    it('should convert strikethroughs properly', () => {
        const markdown = j2m.to_markdown(' -deleted- ');
        markdown.should.eql(' ~~deleted~~ ');
    });
    it('should convert inserts properly', () => {
        const markdown = j2m.to_markdown('+inserted+');
        markdown.should.eql('<ins>inserted</ins>');
    });
    it('should convert superscript properly', () => {
        const markdown = j2m.to_markdown('^superscript^');
        markdown.should.eql('<sup>superscript</sup>');
    });
    it('should convert subscript properly', () => {
        const markdown = j2m.to_markdown('~subscript~');
        markdown.should.eql('<sub>subscript</sub>');
    });
    it('should convert preformatted blocks properly', () => {
        const markdown = j2m.to_markdown('{noformat}\nso *no* further _formatting_ is done here\n{noformat}');
        markdown.should.eql('```\nso **no** further *formatting* is done here\n```');
    });
    it('should convert language-specific code blocks properly', () => {
        const markdown = j2m.to_markdown("{code:javascript}\nconst hello = 'world';\n{code}");
        markdown.should.eql("```javascript\nconst hello = 'world';\n```");
    });
    it('should convert code without language-specific and with title into code block', () => {
        const markdown = j2m.to_markdown(
            '{code:title=Foo.java}\nclass Foo {\n  public static void main() {\n  }\n}\n{code}'
        );
        markdown.should.eql('```\nclass Foo {\n  public static void main() {\n  }\n}\n```');
    });
    it('should convert code without line feed before the end code block', () => {
        const markdown = j2m.to_markdown('{code:java}\njava code{code}');
        markdown.should.eql('```java\njava code\n```');
    });
    it('should convert fully configured code block', () => {
        const markdown = j2m.to_markdown(
            '{code:xml|title=My Title|borderStyle=dashed|borderColor=#ccc|titleBGColor=#F7D6C1|bgColor=#FFFFCE}' +
                '\n    <test>' +
                '\n        <another tag="attribute"/>' +
                '\n    </test>' +
                '\n{code}'
        );
        markdown.should.eql('```xml\n    <test>\n        <another tag="attribute"/>\n    </test>\n```');
    });
    it('should convert images properly', () => {
        const markdown = j2m.to_markdown('!http://google.com/image!');
        markdown.should.eql('![](http://google.com/image)');
    });
    it('should convert linked images properly', () => {
        const markdown = j2m.to_markdown('[!http://google.com/image!|http://google.com/link]');
        markdown.should.eql('[![](http://google.com/image)](http://google.com/link)');
    });
    it('should convert unnamed links properly', () => {
        const markdown = j2m.to_markdown('[http://google.com]');
        markdown.should.eql('<http://google.com>');
    });
    it('should convert named links properly', () => {
        const markdown = j2m.to_markdown('[Google|http://google.com]');
        markdown.should.eql('[Google](http://google.com)');
    });
    it('should convert headers properly', () => {
        const h1 = j2m.to_markdown('h1. Biggest heading');
        const h2 = j2m.to_markdown('h2. Bigger heading');
        const h3 = j2m.to_markdown('h3. Big heading');
        const h4 = j2m.to_markdown('h4. Normal heading');
        const h5 = j2m.to_markdown('h5. Small heading');
        const h6 = j2m.to_markdown('h6. Smallest heading');
        h1.should.eql('# Biggest heading');
        h2.should.eql('## Bigger heading');
        h3.should.eql('### Big heading');
        h4.should.eql('#### Normal heading');
        h5.should.eql('##### Small heading');
        h6.should.eql('###### Smallest heading');
    });
    it('should convert blockquotes properly', () => {
        const markdown = j2m.to_markdown('bq. This is a long blockquote type thingy that needs to be converted.');
        markdown.should.eql('> This is a long blockquote type thingy that needs to be converted.');
    });
    it('should convert un-ordered lists properly', () => {
        const markdown = j2m.to_markdown('* Foo\n* Bar\n* Baz\n** FooBar\n** BarBaz\n*** FooBarBaz\n* Starting Over');
        markdown.should.eql('* Foo\n* Bar\n* Baz\n  * FooBar\n  * BarBaz\n    * FooBarBaz\n* Starting Over');
    });
    it('should convert ordered lists properly', () => {
        const markdown = j2m.to_markdown('# Foo\n# Bar\n# Baz\n## FooBar\n## BarBaz\n### FooBarBaz\n# Starting Over');
        markdown.should.eql('1. Foo\n1. Bar\n1. Baz\n   1. FooBar\n   1. BarBaz\n      1. FooBarBaz\n1. Starting Over');
    });
    it('should handle bold AND italic (combined) correctly', () => {
        const markdown = j2m.to_markdown('This is _*emphatically bold*_!');
        markdown.should.eql('This is ***emphatically bold***!');
    });
    it('should handle bold within a un-ordered list item', () => {
        const markdown = j2m.to_markdown('* This is not bold!\n** This is *bold*.');
        markdown.should.eql('* This is not bold!\n  * This is **bold**.');
    });
    it('should be able to handle a complicated multi-line jira-wiki string and convert it to markdown', () => {
        const jiraStr = fs.readFileSync(path.resolve(__dirname, 'test.jira'), 'utf8');
        const mdStr = fs.readFileSync(path.resolve(__dirname, 'test.md'), 'utf8');
        const markdown = j2m.to_markdown(jiraStr);
        markdown.should.eql(mdStr);
    });
    it('should not recognize strikethroughs over multiple lines', () => {
        const markdown = j2m.to_markdown(
            "* Here's an un-ordered list line\n* Multi-line strikethroughs shouldn't work."
        );
        markdown.should.eql("* Here's an un-ordered list line\n* Multi-line strikethroughs shouldn't work.");
    });
    it('should remove color attributes', () => {
        const markdown = j2m.to_markdown('A text with{color:blue} blue \n lines {color} is not necessary.');
        markdown.should.eql('A text with blue \n lines  is not necessary.');
    });
    it('should remove multiple color attributes', () => {
        const markdown = j2m.to_markdown(
            'A text with{color:blue} blue \n lines {color} is not necessary. {color:red} red {color}'
        );
        markdown.should.eq('A text with blue \n lines  is not necessary.  red ');
    });
    // it('should not recognize inserts across multiple table cells', () => {
    //      const markdown = j2m.to_markdown('||Heading 1||Heading 2||\n|Col+A1|Col+A2|');
    //      markdown.should.eql('\n|Heading 1|Heading 2|\n| --- | --- |\n|Col+A1|Col+A2|');
    //  });
});
