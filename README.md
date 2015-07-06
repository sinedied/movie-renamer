# movie-renamer
Automated movie renamer scraping names from IMDB.

It targets all .mkv files in a folder, and the renaming process is interactive: best match is proposed by default, or you can either choose any other match or to skip renaming for each file.

Better search heuristic may be added later in case of no results from IMDB, along with manual rename fallback.

# Install
```
npm install -g movie-renamer
```

# Usage
```
movie-renamer <target_folder>
```
