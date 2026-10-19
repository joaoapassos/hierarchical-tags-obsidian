import * as esbuild from "esbuild";

const context = await esbuild.context({
	entryPoints: ["src/main.ts"],
	bundle: true,
	external: ["obsidian"],
	format: "cjs",
	target: "es2020",
	platform: "browser",
	outfile: "main.js",
	logLevel: "info",
	minify: !process.argv.includes("--watch"),
});
if (process.argv.includes("--watch")) {
	await context.watch();
} else {
	await context.rebuild();
	await context.dispose();
}
