import * as esbuild from 'esbuild'

// Appends .js to extensionless three.js deep imports (examples/jsm/* and src/*)
const threeResolverPlugin = {
  name: 'three-resolver',
  setup(build) {
    build.onResolve({ filter: /^three\/(examples\/jsm|src)\// }, (args) => {
      if (!args.path.endsWith('.js')) {
        return build.resolve(args.path + '.js', {
          kind: args.kind,
          resolveDir: args.resolveDir,
        })
      }
    })
  },
}

await esbuild.build({
  entryPoints: ['dist/workers/RenderWorker.js'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: 'dist/workers/RenderWorker.bundle.js',
  external: ['canvas', 'gl', 'sharp', 'lru-cache', 'winston'],
  plugins: [threeResolverPlugin],
  loader: {
    '.glsl': 'text',
    '.jpg': 'dataurl',
  },
})
