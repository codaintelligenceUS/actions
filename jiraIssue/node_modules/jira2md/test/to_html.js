const should = require('chai').should();
const fs = require('fs');
const path = require('path');

const j2m = require('../index');

describe('md_to_html', () => {
    it('should exist', () => {
        should.exist(j2m.md_to_html(''));
    });

    it('should be a function', () => {
        j2m.md_to_html.should.be.a('function');
    });

    it('should provide html from md', () => {
        const mdStr = fs.readFileSync(path.resolve(__dirname, 'test.md'), 'utf8');
        const htmlStr = fs.readFileSync(path.resolve(__dirname, 'test.html'), 'utf8');

        const html = j2m.md_to_html(mdStr);
        html.should.eql(htmlStr);
    });
});

describe('jira_to_html', () => {
    it('should exist', () => {
        should.exist(j2m.jira_to_html(''));
    });

    it('should be a function', () => {
        j2m.jira_to_html.should.be.a('function');
    });

    it('should provide html from md', () => {
        const jiraStr = fs.readFileSync(path.resolve(__dirname, 'test.jira'), 'utf8');
        const htmlStr = fs.readFileSync(path.resolve(__dirname, 'test.html'), 'utf8');

        const html = j2m.jira_to_html(jiraStr);
        html.should.eql(htmlStr);
    });
});
