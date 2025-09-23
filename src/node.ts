/**
 * @jpglab/fuse - Node.js Entry Point
 * 
 * Full-featured entry point with USB device discovery and filesystem operations.
 */

// Re-export all common exports
export * from './exports'

// Discovery functions with Node.js support
export { listCameras, watchCameras } from '@client/discovery'