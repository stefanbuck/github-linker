'use strict';

var githubURLParser = require('github-url-from-git');
var _ = require('lodash');
var path = require('path');
var fs = require('fs');
var request = require('request');
var JSONStream = require('JSONStream');
var es = require('event-stream');

module.exports = function(grunt) {

    var parseURL = function(url) {

        // Remove last trailing slash
        if (url.slice(-1) === '/') {
            url = url.slice(0, -1);
        }
        // Fix multiple forward slashes
        url = url.replace(/([^:]\/)\/+/g, '$1');

        // Resolve shorthand url to a qualified URL
        if (url.split('/').length === 2) {
            url = 'http://github.com/' + url;
        }

        // Replace and fix invalid urls
        url = url.replace('https+git://', 'git+https://');
        url = url.replace('://www.github.com', '://github.com');

        // Resolve detail link
        url = url.split('/tree/master')[0];
        url = url.split('/blob/master')[0];

        var githubUrl = githubURLParser(url);
        if (githubUrl) {
            return githubUrl;
        }
    };

    var getRepoURL = function(node) {
        if (typeof node === 'string') {
            return parseURL(node);
        } else if (node.url) {
            return parseURL(node.url);
        } else if (node.path) {
            return parseURL(node.path);
        } else if (node.web) {
            return parseURL(node.web);
        } else if (node.git) {
            return parseURL(node.git);
        }
    };

    var lookup = function(node) {
        if (Array.isArray(node)) {
            return getRepoURL(node[0]);
        } else {
            return getRepoURL(node);
        }
    };

    var getURL = function(node) {
        var result = null;

        if (node.repository) {
            result = lookup(node.repository);
        }

        return result;
    };

    grunt.registerTask('composerCache', function() {
        var done = this.async();

        var options = {
            uri: 'https://packagist.org/packages/list.json?fields[]=repository',
            jsonStreamPath: 'packages.*',
            filter: ['name', 'repository']
        };

        var dataPath = path.resolve('app/scripts/cache/composer.js');
        var oldResult = {};
        if (fs.existsSync(dataPath)) {
            oldResult = require(dataPath);
        }

        var filter = es.mapSync(function(item) {
            if (options.filter && Array.isArray(options.filter)) {
                item = _.pick(item, options.filter);
            }
            if (options.transformer && _.isFunction(options.transformer)) {
                item = options.transformer(item);
            }
            return item;
        });

        var repoParser = es.map(function(item, cb) {
            var repoURL = getURL(item);
            if (!repoURL) {
                return cb();
            }
            totalCount++;
            if (!oldResult[item.name]) {
                newItemsCount++;
            }
            cb(null, [item.name, repoURL]);
        });

        var totalCount = 0;
        var newItemsCount = 0;

        var handleEnd = function() {
            grunt.log.writeln('newItemsCount: ' + newItemsCount);
            grunt.log.writeln('totalComposerItems: ' + totalCount);
            grunt.config.set('newComposerItems', newItemsCount);
            grunt.config.set('totalComposerItems', totalCount);
            done();
        };

        var handleData = function(data) {
            grunt.log.writeln(data.name);
        };

        request.get(options.uri)
        .pipe(JSONStream.parse(options.jsonStreamPath, 
        		function (item, path) {
		    		item.name = path[path.length - 1];
		    		return item;
		        }))
        .pipe(filter)
        .on('data', handleData)
        .pipe(repoParser)
        .pipe(JSONStream.stringifyObject('module.exports = {\n', ',\n', '\n}\n'))
        .pipe(fs.createWriteStream(dataPath))
        .on('finish', handleEnd);
    });
};
