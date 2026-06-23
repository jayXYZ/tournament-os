// Learn more: https://docs.expo.dev/guides/monorepos/
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// 1. Watch all files within the monorepo so changes to shared packages
//    (@tournament-os/backend, @tournament-os/core) trigger fast refresh.
config.watchFolders = [workspaceRoot];

// 2. Resolve modules from this app first, then fall back to the workspace root.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// 3. Force singleton packages to a single copy.
//    pnpm installs per-peer-dependency instances of these packages, so shared
//    workspace packages (@tournament-os/core) and this app can otherwise resolve
//    different physical copies. Metro keys modules by absolute path, so duplicate
//    copies create duplicate React contexts — which breaks ConvexProvider lookup
//    ("Could not find Convex client") and React hooks ("Invalid hook call").
//    Redirecting these to the app's copy guarantees one instance.
const singletonPackages = ['react', 'react-dom', 'convex'];

const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const isSingleton = singletonPackages.some(
    (pkg) => moduleName === pkg || moduleName.startsWith(`${pkg}/`),
  );

  if (isSingleton) {
    return context.resolveRequest(
      { ...context, originModulePath: path.join(projectRoot, 'package.json') },
      moduleName,
      platform,
    );
  }

  return (defaultResolveRequest ?? context.resolveRequest)(
    context,
    moduleName,
    platform,
  );
};

module.exports = config;
