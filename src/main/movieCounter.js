const Store = require('electron-store');
const movieStore = new Store({ name: 'movie-directory-counter' });

function getCount(moviePath) {
    return movieStore.get(`counts.${moviePath}`, 0);
}

function incrementCount(moviePath) {
    const currentCount = getCount(moviePath);
    movieStore.set(`counts.${moviePath}`, currentCount + 1);
    return currentCount + 1;
}

module.exports = { getCount, incrementCount };
