// anti-FOUC: set theme before first paint — neo-brutalist default
document.documentElement.dataset.theme =
  localStorage.getItem('councilog.theme') || 'brutalist-light';
