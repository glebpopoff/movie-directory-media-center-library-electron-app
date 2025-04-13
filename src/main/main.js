const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { getCount, incrementCount } = require('./movieCounter');
const fsPromises = fs.promises;
const { exec } = require('child_process');
const Store = require('electron-store');
const fetch = require('node-fetch');
const https = require('https');

// Store for caching poster paths
const posterCache = new Store({
    name: 'poster-cache',
    defaults: {}
});

let mainWindow;
const store = new Store();

// Supported video formats
const VIDEO_FORMATS = ['.mp4', '.mkv', '.avi', '.mov', '.wmv'];

// Helper function to check if a file is a movie
function isMovieFile(filename) {
    const movieExtensions = ['.mp4', '.mpeg4', '.avi', '.mkv'];
    return movieExtensions.some(ext => filename.toLowerCase().endsWith(ext));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile('public/index.html');
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', function () {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Helper function to download image
async function downloadImage(url, filepath) {
  if (!url) return null;
  
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download image: ${response.statusCode}`));
        return;
      }

      const fileStream = fs.createWriteStream(filepath);
      response.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close();
        resolve(filepath);
      });

      fileStream.on('error', reject);
    }).on('error', reject);
  });
}

// Get all subdirectories
async function getSubdirectories(directory) {
    if (!directory) return [];
    
    try {
        console.log('Scanning directory:', directory);
        const items = await fs.readdir(directory, { withFileTypes: true });
        const dirs = items
            .filter(item => item.isDirectory())
            .map(item => item.name)
            .sort((a, b) => a.localeCompare(b));
        
        console.log('Found directories:', dirs);
        return dirs;
    } catch (error) {
        console.error('Error reading directories:', error);
        return [];
    }
}

// Scan directory for movies
async function scanDirectory(directory) {
    const movies = [];
    const cacheDir = path.join(app.getPath('userData'), 'cache');
    
    try {
        await fs.mkdir(cacheDir, { recursive: true });
    } catch (error) {
        console.error('Error creating cache directory:', error);
    }

    // Get immediate subdirectories first
    const items = await fs.readdir(directory, { withFileTypes: true });
    const dirs = items
        .filter(item => item.isDirectory())
        .map(item => item.name);

    // Process each directory
    for (const dir of dirs) {
        const dirPath = path.join(directory, dir);
        const files = await fs.readdir(dirPath);
        
        for (const file of files) {
            const fullPath = path.join(dirPath, file);
            const stat = await fs.stat(fullPath);
            
            if (!stat.isDirectory() && VIDEO_FORMATS.includes(path.extname(file).toLowerCase())) {
                const movieName = path.basename(file, path.extname(file));
                
                try {
                    const movie = await IMDB.get({ name: movieName }, { apiKey: store.get('imdbApiKey') });
                    if (movie && movie.poster) {
                        const posterPath = path.join(cacheDir, `${movie.imdbid}.jpg`);
                        try {
                            await downloadImage(movie.poster, posterPath);
                            movie.localPoster = posterPath;
                        } catch (error) {
                            console.error(`Error downloading poster for ${movieName}:`, error);
                        }
                    }
                    
                    movies.push({
                        name: movieName,
                        path: fullPath,
                        category: dir,
                        info: movie
                    });
                } catch (error) {
                    console.error(`Error fetching info for ${movieName}:`, error);
                    movies.push({
                        name: movieName,
                        path: fullPath,
                        category: dir,
                        info: null
                    });
                }
            }
        }
    }

    return movies;
}

// IPC handlers
ipcMain.handle('get-profile-images', async () => {
    const profileImagesDir = path.join(__dirname, '..', '..', 'profile-images');
    try {
        const files = await fsPromises.readdir(profileImagesDir);
        return files.filter(file => /\.(jpg|jpeg|png|gif)$/i.test(file));
    } catch (error) {
        console.error('Error reading profile images:', error);
        return [];
    }
});

ipcMain.handle('select-directory', async () => {
    try {
        const result = await dialog.showOpenDialog({
            properties: ['openDirectory'],
            title: 'Select Movies Directory',
            buttonLabel: 'Choose Directory',
            message: 'Select the root directory containing your movie categories'
        });

        if (!result.canceled && result.filePaths.length > 0) {
            const directory = result.filePaths[0];
            console.log('Selected directory:', directory);
            return directory;
        }
        return null;
    } catch (error) {
        console.error('Error selecting directory:', error);
        throw error;
    }
});

ipcMain.handle('get-categories', async (event, directory) => {
    console.log('Getting categories for directory:', directory);
    if (!directory) {
        console.warn('No directory provided to get-categories');
        return [];
    }
    try {
        if (!directory) {
            console.error('No directory provided');
            return [];
        }

        console.log('Reading categories from:', directory);
        const items = await fsPromises.readdir(directory, { withFileTypes: true });
        const categories = items
            .filter(item => item.isDirectory())
            .map(item => item.name);
        console.log('Found categories:', categories);
        return categories;
    } catch (error) {
        console.error('Error reading categories:', error);
        throw error;
    }
});

ipcMain.handle('get-movie-folders', async (event, categoryPath) => {
    try {
        console.log('Reading category path:', categoryPath);
        if (!categoryPath) {
            console.warn('Category path is undefined');
            return [];
        }

        // Check if category directory exists
        try {
            await fsPromises.access(categoryPath);
        } catch (error) {
            console.warn('Category directory does not exist:', categoryPath);
            return [];
        }

        // Read directory contents
        const items = await fsPromises.readdir(categoryPath, { withFileTypes: true });
        console.log('Found items in category:', items.length);

        // Get only directories
        const directories = items.filter(item => item.isDirectory());
        console.log('Found directories:', directories.length);

        // Process each directory
        const movieFolders = [];
        for (const dir of directories) {
            try {
                const folderPath = path.join(categoryPath, dir.name);
                console.log('Processing folder:', folderPath);

                // Check for poster in _data folder
                const dataDir = path.join(folderPath, '_data');
                const posterPath = path.join(dataDir, 'poster.jpg');
                let hasPoster = false;
                try {
                    await fsPromises.access(posterPath);
                    hasPoster = true;
                } catch (err) {
                    // Poster doesn't exist in _data folder
                    // Try legacy location as fallback
                    const legacyPosterPath = path.join(folderPath, 'poster.jpg');
                    try {
                        await fsPromises.access(legacyPosterPath);
                        hasPoster = true;
                        // Move poster to _data folder
                        try {
                            await fsPromises.mkdir(dataDir, { recursive: true });
                            await fsPromises.copyFile(legacyPosterPath, posterPath);
                            await fsPromises.unlink(legacyPosterPath);
                            console.log('Moved poster to _data folder:', posterPath);
                        } catch (moveErr) {
                            console.error('Error moving poster to _data folder:', moveErr);
                        }
                    } catch (legacyErr) {
                        // No poster exists anywhere
                    }
                }

                movieFolders.push({
                    name: dir.name,
                    path: folderPath,
                    posterPath: hasPoster ? posterPath : null
                });
            } catch (err) {
                console.error('Error processing folder:', dir.name, err);
                // Skip failed folders
            }
        }

        console.log('Successfully processed folders:', movieFolders.length);
        return movieFolders;
    } catch (error) {
        console.error('Error in get-movie-folders:', error);
        return []; // Return empty array on error
    }
});

ipcMain.handle('fetch-poster', async (event, { folderName, folderPath, forceRefetch }) => {
    // Check cache unless force refetch is requested
    if (!forceRefetch) {
        const cachedPath = posterCache.get(folderName);
        if (cachedPath) {
            try {
                await fsPromises.access(cachedPath);
                return { posterPath: cachedPath };
            } catch (err) {
                // Cached file doesn't exist, remove from cache
                posterCache.delete(folderName);
            }
        }
    }
    try {
        // Clean up folder name for search
        const searchTitle = folderName
            .replace(/\([^)]*\)/g, '') // Remove parentheses and content
            .replace(/\[[^\]]*\]/g, '') // Remove brackets and content
            .replace(/\.(mp4|avi|mkv|mpeg4)$/i, '') // Remove file extension
            .replace(/[._]/g, ' ') // Replace dots and underscores with spaces
            .trim();

        console.log('Searching IMDB for:', searchTitle);
        
        // Search IMDB
        const searchUrl = `https://www.imdb.com/find/?q=${encodeURIComponent(searchTitle)}`;
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5'
        };

        // Get search results
        console.log('Fetching search results from:', searchUrl);
        const searchResponse = await fetch(searchUrl, { headers });
        if (!searchResponse.ok) throw new Error(`IMDB search failed: ${searchResponse.status}`);
        
        const searchHtml = await searchResponse.text();

        // Create _data directory if it doesn't exist
        const dataDir = path.join(folderPath, '_data');
        try {
            await fsPromises.mkdir(dataDir, { recursive: true });
        } catch (err) {
            if (err.code !== 'EEXIST') throw err;
        }

        // Save search results for debugging
        const debugPath = path.join(dataDir, 'imdb_search.html');
        await fsPromises.writeFile(debugPath, searchHtml);
        console.log('Saved search results to:', debugPath);

        // Find first movie result using regex
        const movieLinkMatch = searchHtml.match(/href=\"(\/title\/tt\d+)/i);
        if (!movieLinkMatch) throw new Error('Movie not found on IMDB');
        
        const movieLink = movieLinkMatch[1];
        console.log('Found movie link:', movieLink);

        // Get movie page
        const movieUrl = `https://www.imdb.com${movieLink}`;
        console.log('Fetching movie page:', movieUrl);
        
        const movieResponse = await fetch(movieUrl, { headers });
        if (!movieResponse.ok) throw new Error(`Failed to fetch movie page: ${movieResponse.status}`);
        
        const movieHtml = await movieResponse.text();

        // Save movie page for debugging
        const movieDebugPath = path.join(dataDir, 'imdb_movie.html');
        await fsPromises.writeFile(movieDebugPath, movieHtml);
        console.log('Saved movie page to:', movieDebugPath);

        // Find poster image using regex
        const posterMatch = movieHtml.match(/"hero-media__poster"[^>]*>.*?<img[^>]*src=\"([^\"]+)\"/i) ||
                          movieHtml.match(/"ipc-image"[^>]*?src=\"([^\"]+)\"/i);
        
        const posterUrl = posterMatch ? posterMatch[1] : null;

        if (!posterUrl) throw new Error('No poster found on IMDB');
        console.log('Found poster URL:', posterUrl);

        // Download poster
        const imageResponse = await fetch(posterUrl);
        if (!imageResponse.ok) throw new Error(`Failed to download poster: ${imageResponse.status}`);
        
        const imageBuffer = await imageResponse.buffer();
        const posterPath = path.join(dataDir, 'poster.jpg');
        await fsPromises.writeFile(posterPath, imageBuffer);

        // Cache the poster path
        posterCache.set(folderName, posterPath);
        console.log('Saved poster to:', posterPath);

        return { posterPath };
    } catch (error) {
        console.error('Error fetching poster:', error);
        throw error;
    }
});

// Helper function to download images
async function downloadImage(url, filepath) {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to download image: ${response.status}`);
        }

        const buffer = await response.buffer();
        await fsPromises.writeFile(filepath, buffer);
    } catch (error) {
        console.error('Error downloading image:', error);
        throw error;
    }
}

ipcMain.handle('play-in-vlc', async (event, moviePath) => {
    if (!moviePath) {
        console.error('No movie file path provided');
        return false;
    }

    try {
        exec(`open -a VLC '${moviePath}'`, (error) => {
            if (error) {
                console.error('Error opening VLC:', error);
                return false;
            }
        });
        return true;
    } catch (error) {
        console.error('Error launching VLC:', error);
        return false;
    }
});

ipcMain.handle('open-in-finder', async (event, dirPath) => {
    try {
        await shell.openPath(dirPath);
        return true;
    } catch (error) {
        console.error('Error opening Finder:', error);
        return false;
    }
});

// Movie counter handlers
ipcMain.handle('get-movie-count', async (event, moviePath) => {
    return getCount(moviePath);
});

ipcMain.handle('increment-movie-count', async (event, moviePath) => {
    return incrementCount(moviePath);
});

ipcMain.handle('scan-directory', async (event, directory) => {
  return await scanDirectory(directory);
});

ipcMain.handle('fetch-movie-info', async (event, movieName) => {
  try {
    const client = new IMDB.Client({ apiKey: process.env.IMDB_API_KEY || 'your-api-key' });
    const movie = await client.get({ name: movieName });
    return movie;
  } catch (error) {
    console.error('Error fetching movie info:', error);
    return null;
  }
});

// Handle opening movie in VLC
ipcMain.handle('open-movie', async (event, path) => {
  const { exec } = require('child_process');
  exec(`open -a VLC "${path}"`);
});

// Handle opening directory in Finder
ipcMain.handle('open-directory', async (event, path) => {
  const { shell } = require('electron');
  shell.showItemInFolder(path);
});
