import spLogoAsset from '@/assets/sp-logo.png';
import studioMarkAsset from '@/assets/studio-mark.png';
import spLoaderBaseAsset from '@/assets/sp-loader-base.png';
import spLoaderArcsAsset from '@/assets/sp-loader-arcs.png';
import spLoaderDotAsset from '@/assets/sp-loader-dot.png';

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

/**
 * Layered SocialPulse AI loader mark (approved "final" prototype artwork):
 * stationary navy base, independently-animated arcs layer, pulsing center
 * dot. Separate files (not one flattened PNG) so each layer animates on its
 * own without redrawing the mark. Same hashed-URL treatment as SP_LOGO above.
 */
export const SP_LOADER_BASE = spLoaderBaseAsset.src;
export const SP_LOADER_ARCS = spLoaderArcsAsset.src;
export const SP_LOADER_DOT = spLoaderDotAsset.src;
