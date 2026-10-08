import spLogoAsset from '@/assets/sp-logo.png';
import studioMarkAsset from '@/assets/studio-mark.png';

/**
 * Brand asset URLs.
 *
 * These are imported from src/assets rather than served out of /public on
 * purpose. Files in /public are served from a stable, unhashed URL
 * (/sp-logo.png) with `cache-control: public, max-age=14400`, so replacing the
 * bytes leaves every browser and CDN edge holding the previous image for up to
 * four hours. That is how a swapped logo shipped as the OLD mark on one browser
 * profile and the NEW mark on another.
 *
 * Importing the files makes webpack emit them under /_next/static/media/ with
 * a content hash in the filename. The URL therefore changes whenever the bytes
 * change, so a new logo can never be served from a stale cache again - and the
 * old hashed URLs stay correct for anyone still holding them.
 *
 * Do NOT reintroduce "/sp-logo.png" style literal paths for brand artwork.
 * Add the file to src/assets and re-export it here.
 */
export const SP_LOGO = spLogoAsset.src;
export const STUDIO_MARK = studioMarkAsset.src;
