/**
 * esbuild configuration for VS Code Pulsar Client Extension
 *
 * This bundles the extension into a single optimized file for production.
 */

const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
    name: 'esbuild-problem-matcher',
    setup(build) {
        build.onStart(() => {
            console.log('[watch] build started');
        });
        build.onEnd((result) => {
            result.errors.forEach(({ text, location }) => {
                console.error(`✘ [ERROR] ${text}`);
                if (location) {
                    console.error(`    ${location.file}:${location.line}:${location.column}:`);
                }
            });
            console.log('[watch] build finished');
        });
    },
};

async function main() {
    const ctx = await esbuild.context({
        entryPoints: [
            'src/extension.ts'
        ],
        bundle: true,
        format: 'cjs',
        minify: production,
        sourcemap: !production,
        sourcesContent: false,
        platform: 'node',
        outfile: 'dist/extension.js',
        external: [
            'vscode',
            // These packages have native dependencies and should be external
            'bufferutil',
            'utf-8-validate'
        ],
        logLevel: 'info',
        plugins: [
            esbuildProblemMatcherPlugin,
        ],
        // Node.js version target
        target: 'node20',
        // Keep dynamic imports
        keepNames: true,
        // Define NODE_ENV for better optimization
        define: {
            'process.env.NODE_ENV': production ? '"production"' : '"development"'
        },
        // Banner for production builds
        banner: {
            js: production ? '// VS Code Pulsar Client Extension - Bundled with esbuild' : ''
        }
    });

    if (watch) {
        await ctx.watch();
        console.log('[watch] watching for changes...');
    } else {
        await ctx.rebuild();
        await ctx.dispose();
        console.log('[build] complete');
    }
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
