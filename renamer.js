#!/usr/bin/env node

var fs = require('fs'),
    _ = require('lodash'),
    q = require('q'),
    request = require('request-promise'),
    inquirer = require("inquirer"),
    cheerio = require('cheerio');

// constants	
var imdbUrl = 'http://www.imdb.com/find?q=';
var resultSelector = '.findList .result_text';
var movieExt = '.mkv';

// global
var ui = new inquirer.ui.BottomBar();
var log = ui.log.write;
var progress = {
  total: 0,
  current: 0
};

function main() { 
  var processedFiles = [];
  log('Listing files...');

  getMovies(process.argv[2])
    .then(function(files) {
      if (!files.length) {
        log('No files to process!');
        throw 1;
      }

      log('Scraping IMDB results...');
      progress.total = files.length;
      
      // scrap names for all files
      return scrapNamesOnce(files);
    })
    .then(function(files) {
      ui.updateBottomBar('');
      return askUser(files);
    })
    .then(renameFiles);
}

function getFinalName(file, baseName) {
  if (!file.results || !file.results.length)
    return null;

  var index;
  if (!baseName && file.year) {
    var regex = new RegExp(file.year);

    index = _.findIndex(file.results, function(result) {
      return regex.test(result);
    });
  }
  
  if (!index || index < 0)
    index = 0;
  
  var name = baseName || file.results[index];
  
  if (file.multi)
    name += ' [MULTi]';

  if (file.dts)
    name += ' [DTS]';
  
  if (file.vo)
    name += ' [VO]';

  if (file.atmos)
    name += ' [Atmos]';

  if (file.bluray)
    name += ' [BluRay]';
  
  if (file.quality)
    name += ' [' + file.quality + 'p]';

  return name + movieExt;
}

function scrapNamesOnce(files) {
  var promises = _.map(files, function(file) {
    return getImdbName(file.name).then(function(results) {
      file.results = results;
      progress.current++;
      ui.updateBottomBar('Scraped ' + progress.current + '/' + progress.total);
      return results;
    });
  });

  // wait until all scrap requests are finished
  return q.all(promises).then(function() {
    return files;
  });  
}

function scrapNames(files) {
  // recursive promise builder so sequence requests
  var promiseBuilder = function(i) {
    return getImdbName(files[i].name).then(function(results) {
      files[i].results = results;
      progress.current++;
      ui.updateBottomBar('Scraped ' + progress.current + '/' + progress.total);
      return ++i < files.length ? promiseBuilder(i) : files;
    });
  }
  
  return promiseBuilder(0);
}

function askUser(files) {
  var deferred = q.defer();
  var questions = [];
  var skipRename = '>> Do not rename';
  
  _.each(files, function(file) {
    file.new = getFinalName(file);

    // best match?
    questions.push({
      type: 'confirm',
      name: file.original + '.best',
      message: '  ' + file.original + '\n -> ' + file.new,
      default: true,
      when: !!file.new
    });

    // choose from results
    var choices = file.results || [];
    choices.unshift(skipRename);

    questions.push({
      type: 'list',
      name: file.original + '.choice',
      message: 'Choose name',
      choices: choices,
      when: function(answers) {
        return file.new && !answers[file.original + '.best'];
      }
    });

    // TODO: manual option
    
  });

  inquirer.prompt(questions, function(answers) {
    _.each(files, function(file) {
      // update new file name if best choice was not selected
      if (!answers[file.original + '.best']) {
        var baseName = answers[file.original + '.choice'];
        baseName = baseName && baseName !== skipRename ? baseName : null;
        file.new = baseName ? getFinalName(file, baseName) : null;
      }
    });

    deferred.resolve(files);
  });

  return deferred.promise;
}

function renameFiles(files) {
  log('Renaming files...');

  _.each(files, function(file) {
    if (file.new) {
      fs.rename(process.argv[2] + '/' + file.original, process.argv[2] + '/' + file.new, function(err) {
        if (err)
          log('Error while renaming "' + file.original + '": ' + err);
      });
    }
  });

  log('Done!');
}

function getMovies(path) {
  var readdir = q.denodeify(fs.readdir);
  
  return readdir(path || __dirname).then(function(files) {
    files = _.filter(files, function(name) {
      return name.indexOf(movieExt, name.length - movieExt.length) !== -1;
    });

    return _.map(files, parseFileName);
  });
}

function getImdbName(search) {
  var url = imdbUrl + encodeURIComponent(search);
  
  return request(url).then(function (body) {
    var $ = cheerio.load(body);
    var movies = $('.findList').first();
    var results = [];
    
    movies.find('.result_text')
      .each(function() {
        var title = cleanTitle($(this).text());
        if (title)
          results.push(sanitizeForFileName(title));
      });
    
    return results;
  }, function(result) {
    log('Error while retrieving results for "' + search + '": ' 
      + JSON.stringify(result));
  });  
}

function cleanTitle(title) {
  title = title.replace(/ \([A-Z]*?\)/g, '');
  var match = /(.*?\([0-9]*\))/.exec(title);
  return match ? match[1].trim() : null;
}

function sanitizeForFileName(title) {
  title = title.replace(/:/g, ' -');
  return title.replace(/[\/*?"<>|]/g, '').trim();
}

function parseFileName(name) {
  var file = {};

  file.original = name;
  file.multi = /multi/i.test(name);
  file.vo = !file.multi && /VO/.test(name);
  
   if (/2160p/i.test(name) || /4k/i.test(name))
    file.quality = 2160;
    
  if (/1080p/i.test(name))
    file.quality = 1080;
  
  if (/720p/i.test(name))
    file.quality = 720;

  if (/dts/i.test(name))
    file.dts = true;

  if (/bluray/i.test(name))
    file.bluray = true;

  if (/atmos/i.test(name))
    file.atmos = true;

  name = name.substring(0, name.length - movieExt.length);
  name = name.replace(/\./g, ' ');
  name = name.replace(/_/g, ' ');
  name = name.replace(/(\[|\])/g, '');
  
  // name (year)
  var match = /(.*?\(([0-9]*)\))/.exec(name);
  if (match) {
    name = match[1];
    file.year = match[2];
  }
  
  // name year
  match = /(.*? )([0-9]{4}) /.exec(name);
  if (!file.name && match) {
    name = match[1];
    file.year = match[2];
  }
  
  // clean
  var cleanSeparators = [
    / \([0-9]*\).*/,
    /2160p.*/i,
    /1080p.*/i,
    /720p.*/i,
    / multi .*/i,
    /bluray.*/i,
    /x264.*/i,
    /x265.*/i,
    /hevc.*/i,
    /ac3.*/i
  ];
  
  _.each(cleanSeparators, function(sep) {
    name = name.replace(sep, '');
  });
  
  name = sanitizeForFileName(name);
  file.name = name.trim();
  
  return file;
}

main();
