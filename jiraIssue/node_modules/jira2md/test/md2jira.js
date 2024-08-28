const should = require('chai').should();
const fs = require('fs');
const path = require('path');

const j2m = require('../index');

describe('to_jira', () => {
    it('should exist', () => {
        should.exist(j2m.to_jira);
    });
    it('should be a function', () => {
        j2m.to_jira.should.be.a('function');
    });
    it('should convert bolds properly', () => {
        const jira = j2m.to_jira('**bold**');
        jira.should.eql('*bold*');
    });
    it('should convert italics properly', () => {
        const jira = j2m.to_jira('*italic*');
        jira.should.eql('_italic_');
    });
    it('should convert monospaced content properly', () => {
        const jira = j2m.to_jira('`monospaced`');
        jira.should.eql('{{monospaced}}');
    });
    // it('should convert citations properly', () => {
    //     const jira = j2m.to_jira('<cite>citation</cite>');
    //     jira.should.eql('??citation??');
    // });
    it('should convert strikethroughs properly', () => {
        const jira = j2m.to_jira(' ~~deleted~~ ');
        jira.should.eql(' -deleted- ');
    });
    it('should convert inserts properly', () => {
        const jira = j2m.to_jira('<ins>inserted</ins>');
        jira.should.eql('+inserted+');
    });
    it('should convert superscript properly', () => {
        const jira = j2m.to_jira('<sup>superscript</sup>');
        jira.should.eql('^superscript^');
    });
    it('should convert subscript properly', () => {
        const jira = j2m.to_jira('<sub>subscript</sub>');
        jira.should.eql('~subscript~');
    });
    it('should convert preformatted blocks properly', () => {
        const jira = j2m.to_jira('```\nso *no* further **formatting** is done here\n```');
        jira.should.eql('{code}\nso _no_ further *formatting* is done here\n{code}');
    });
    it('should convert language-specific code blocks properly', () => {
        const jira = j2m.to_jira("```javascript\nconst hello = 'world';\n```");
        jira.should.eql("{code:javascript}\nconst hello = 'world';\n{code}");
    });
    it('should convert unnamed images properly', () => {
        const jira = j2m.to_jira('![](http://google.com/image)');
        jira.should.eql('!http://google.com/image!');
    });
    it('should convert named images properly', () => {
        const jira = j2m.to_jira('![Google](http://google.com/image)');
        jira.should.eql('!http://google.com/image!');
    });
    it('should convert linked images properly', () => {
        const jira = j2m.to_jira('[![Google](http://google.com/image)](http://google.com/link)');
        jira.should.eql('[!http://google.com/image!|http://google.com/link]');
    });
    it('should convert unnamed links properly', () => {
        const jira = j2m.to_jira('<http://google.com>');
        jira.should.eql('[http://google.com]');
    });
    it('should convert named links properly', () => {
        const jira = j2m.to_jira('[Google](http://google.com)');
        jira.should.eql('[Google|http://google.com]');
    });
    it('should convert headers properly', () => {
        const h1 = j2m.to_jira('# Biggest heading');
        const h2 = j2m.to_jira('## Bigger heading');
        const h3 = j2m.to_jira('### Big heading');
        const h4 = j2m.to_jira('#### Normal heading');
        const h5 = j2m.to_jira('##### Small heading');
        const h6 = j2m.to_jira('###### Smallest heading');
        h1.should.eql('h1. Biggest heading');
        h2.should.eql('h2. Bigger heading');
        h3.should.eql('h3. Big heading');
        h4.should.eql('h4. Normal heading');
        h5.should.eql('h5. Small heading');
        h6.should.eql('h6. Smallest heading');
    });
    it('should convert underline-style headers properly', () => {
        const h1 = j2m.to_jira('Biggest heading\n=======');
        const h2 = j2m.to_jira('Bigger heading\n------');
        h1.should.eql('h1. Biggest heading');
        h2.should.eql('h2. Bigger heading');
    });
    it('should convert blockquotes properly', () => {
        const jira = j2m.to_jira('> This is a long blockquote type thingy that needs to be converted.');
        jira.should.eql('bq. This is a long blockquote type thingy that needs to be converted.');
    });
    it('should convert un-ordered lists properly', () => {
        const jira = j2m.to_jira('* Foo\n* Bar\n* Baz\n  * FooBar\n  * BarBaz\n    * FooBarBaz\n* Starting Over');
        jira.should.eql('* Foo\n* Bar\n* Baz\n** FooBar\n** BarBaz\n*** FooBarBaz\n* Starting Over');
    });
    it('should convert ordered lists properly', () => {
        const jira = j2m.to_jira(
            '1. Foo\n1. Bar\n1. Baz\n   1. FooBar\n   1. BarBaz\n      1. FooBarBaz\n1. Starting Over'
        );
        jira.should.eql('# Foo\n# Bar\n# Baz\n## FooBar\n## BarBaz\n### FooBarBaz\n# Starting Over');
    });
    it('should handle bold AND italic (combined) correctly', () => {
        const jira = j2m.to_jira('This is ***emphatically bold***!');
        jira.should.eql('This is _*emphatically bold*_!');
    });
    it('should handle bold within a un-ordered list item', () => {
        const jira = j2m.to_jira('* This is not bold!\n  * This is **bold**.');
        jira.should.eql('* This is not bold!\n** This is *bold*.');
    });
    it('should be able to handle a complicated multi-line markdown string and convert it to markdown', () => {
        const jiraStr = fs.readFileSync(path.resolve(__dirname, 'test.jira'), 'utf8');
        const mdStr = fs.readFileSync(path.resolve(__dirname, 'test.md'), 'utf8');
        const jira = j2m.to_jira(mdStr);
        jira.should.eql(jiraStr);
    });
});
