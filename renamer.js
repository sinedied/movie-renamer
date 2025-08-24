#!/usr/bin/env node
import fs from 'fs';
import inquirer from 'inquirer';
import cheerio from 'cheerio';
import path from 'path';

// constants	
const imdbUrl = 'http://www.imdb.com/find?q=';
const movieExt = '.mkv';

// global
const ui = new inquirer.ui.BottomBar();
const log = ui.log.write;
const progress = {
  total: 0,
  current: 0
};

async function main() {
  try {
    log('Listing files...');

    const files = await getMovies(process.argv[2]);
    if (!files.length) {
      log('No files to process!');
      return;
    }

    log('Scraping IMDB results...');
    progress.total = files.length;

    // Scrap names for all files
    await scrapNamesOnce(files);

    ui.updateBottomBar('');
    const updatedFiles = await askUser(files);

    renameFiles(updatedFiles);
  } catch (error) {
    log('An error occurred:', error);
  }
}

function getFinalName(file, baseName) {
  if (!file.results || !file.results.length)
    return null;

  let index;
  if (!baseName && file.year) {
    let regex = new RegExp(file.year);

    index = file.results.findIndex(result => regex.test(result));
  }
  
  if (!index || index < 0)
    index = 0;
  
  let name = baseName || file.results[index];
  
  if (file.multi)
    name += ' [MULTi]';

  if (file.dts)
    name += ' [DTS]';
  
  if (file.vo)
    name += ' [VO]';

  if (file.atmos)
    name += ' [Atmos]';

  // if (file.bluray)
  //   name += ' [BluRay]';
  
  if (file.quality)
    name += ` [${file.quality}p${file.hdr ? ' HDR' : ''}]`;

  return name + movieExt;
}

async function scrapNamesOnce(files) {
  const promises = files.map(async (file) => {
    const results = await getImdbName(file.name);
    file.results = results;
    progress.current++;
    ui.updateBottomBar(`Scraped ${progress.current}/${progress.total}`);
    return results;
  });

  // Wait until all scrap requests are finished
  await Promise.all(promises);
  return files;
}

async function askUser(files) {
  const skipRename = '>> Do not rename';
  const manualEntry = '>> Enter manually';
  const questions = [];

  for (const file of files) {
    file.new = getFinalName(file);

    // best match?
    if (file.new) {
      questions.push({
        type: 'confirm',
        name: `${file.original}.best`,
        message: `  ${file.original}\n -> ${file.new}`,
        default: true,
      });
    }

    // choose from results
    const choices = file.results ? [skipRename, manualEntry, ...file.results] : [skipRename, manualEntry];

    questions.push({
      type: 'list',
      name: `${file.original}.choice`,
      message: 'Choose name',
      choices: choices,
      when: (answers) => file.new && !answers[`${file.original}.best`],
    });

    // manual entry question
    questions.push({
      type: 'input',
      name: `${file.original}.manual`,
      message: 'Enter movie name manually (e.g., "Movie Title (2023)"):',
      when: (answers) => answers[`${file.original}.choice`] === manualEntry,
    });
  }

  const answers = await inquirer.prompt(questions);

  for (const file of files) {
    // update new file name if best choice was not selected
    if (file.new && !answers[`${file.original}.best`]) {
      let baseName = answers[`${file.original}.choice`];
      
      // Handle manual entry
      if (baseName === manualEntry) {
        baseName = answers[`${file.original}.manual`];
        if (baseName) {
          baseName = sanitizeForFileName(baseName.trim());
        }
      }
      
      baseName = baseName && baseName !== skipRename ? baseName : null;
      file.new = baseName ? getFinalName(file, baseName) : null;
    }
  }

  return files;
}

function renameFiles(files) {
  log('Renaming files...');

  for (const file of files) {
    if (file.new) {
      log(`- Renaming "${file.original}" to "${file.new}"`);
      fs.rename(path.join(process.argv[2], file.original), path.join(process.argv[2], file.new), (err) => {
        if (err) log(`Error while renaming "${file.original}": ${err}`);
      });
    }
  }

  log('Done!');
}

async function getMovies(dirPath) {
  const directory = dirPath || __dirname;
  const files = await fs.promises.readdir(directory);
  const movieFiles = files.filter(name => name.endsWith(movieExt));
  return movieFiles.map(parseFileName);
}

async function getImdbName(search) {
  let url = imdbUrl + encodeURIComponent(search);

  try {
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const body = await response.text();
    let $ = cheerio.load(body);
    let movies = $('.ipc-metadata-list').first();
    let results = [];

    movies.find('.ipc-metadata-list-summary-item__tc')
      .each(function() {
        const rawTitle = $(this).find('.ipc-metadata-list-summary-item__t').text();
        const year = $(this).find('.ipc-metadata-list-summary-item__tl').text();

        let title = cleanTitle(rawTitle, year);
        if (title)
          results.push(sanitizeForFileName(title));
      });

    return results;
  } catch (error) {
    log('Error while retrieving results for "' + search + '": ' 
      + error.message);
    return [];
  }
}

function cleanTitle(title, year) {
  title = title.replace(/ \([A-Z]*?\)/g, '');
  return title.trim() + ` (${year})`;
}

function sanitizeForFileName(title) {
  title = title.replace(/:/g, ' -');
  return title.replace(/[\/*?"<>|]/g, '').trim();
}

function parseFileName(name) {
  let file = {};

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

  if (/10bit/i.test(name))
    file.hdr = true;

  if (/x265/i.test(name))
    file.h265 = true;

  name = name.substring(0, name.length - movieExt.length);
  name = name.replace(/\./g, ' ');
  name = name.replace(/_/g, ' ');
  name = name.replace(/(\[|\])/g, '');
  
  // name (year)
  let match = /(.*?\(([0-9]*)\))/.exec(name);
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
  let cleanSeparators = [
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
  
  for (const sep of cleanSeparators) {
    name = name.replace(sep, '');
  }
  
  name = sanitizeForFileName(name);
  file.name = name.trim();
  
  return file;
}

main();
