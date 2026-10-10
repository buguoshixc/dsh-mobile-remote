import { registerHooks } from "node:module";
import { basename, delimiter, dirname, join, relative } from "node:path";
import { inspect } from "node:util";
import { loadLayeredEnv, loadProfileDirectory, reportSkippedBundles } from "@deepseek-ai/dsh-app-boot";
import { runProfile } from "@deepseek-ai/dsh/profile-boot";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
import { realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as officeSkills from "@deepseek-ai/dsh-skill-office";
import * as workspaceDependencies from "@deepseek-ai/dsh-tool-workspace-dependencies";
//#region \0rolldown/runtime.js
var __defProp = Object.defineProperty;
var __exportAll = (all, no_symbols) => {
	let target = {};
	for (var name in all) __defProp(target, name, {
		get: all[name],
		enumerable: true
	});
	if (!no_symbols) __defProp(target, Symbol.toStringTag, { value: "Module" });
	return target;
};
//#endregion
//#region lib/types/office-engine.js
/** Resolve packaged Office engine manifests from their complete, unpacked resource directories. */
/**
* Locate the archive containing a packaged runtime.
* @param runtimeDir - Prepared or ASAR-contained runtime directory.
* @returns Parent archive path, or undefined for a prepared directory.
*/
function runtimeArchivePath(runtimeDir) {
	const parent = dirname(runtimeDir);
	return basename(parent) === "app.asar" ? parent : void 0;
}
/**
* Keep engine executable and resource paths usable by native child processes outside Electron.
* Hooks apply only to this thread; worker threads must install their own resolver.
* @param runtimeDir - Prepared or ASAR-contained dsh runtime directory.
* @returns Installed resolver for the Host lifetime, or undefined for a non-ASAR runtime.
*/
function installOfficeEngineResolution(runtimeDir) {
	if (runtimeArchivePath(runtimeDir) === void 0) return void 0;
	const root = realpathSync(runtimeDir);
	const archive = dirname(root);
	const source = pathToFileURL(join(root, "node_modules", "@deepseek-ai", "libreoffice-kit-")).href;
	const destination = pathToFileURL(join(`${archive}.unpacked`, relative(archive, root), "node_modules", "@deepseek-ai", "libreoffice-kit-")).href;
	return registerHooks({ resolve(specifier, context, nextResolve) {
		const resolved = nextResolve(specifier, context);
		if (!/^@deepseek-ai\/libreoffice-kit-(?:darwin|win32|linux)-/u.test(specifier)) return resolved;
		const canonical = pathToFileURL(realpathSync(fileURLToPath(resolved.url))).href;
		if (!canonical.startsWith(source)) {
			if (canonical.startsWith(pathToFileURL(archive + "/").href)) throw new Error(`desktop Office engine resolved outside the runtime package directory: ${resolved.url}`);
			return resolved;
		}
		const physical = realpathSync(fileURLToPath(destination + canonical.slice(source.length)));
		return {
			...resolved,
			url: pathToFileURL(physical).href
		};
	} });
}
//#endregion
//#region lib/types/office.js
/** Desktop Office skills and bundled authoring dependencies. */
var office_exports = /* @__PURE__ */ __exportAll({
	apply: () => apply,
	name: () => name
});
/** Loader identity for the application-owned Office composition. */
const name = "desktop-office";
/**
* Enable offline Office authoring and structural checks in the Desktop profile.
* @param ctx - Profile scope; child plugins declare their own service requirements.
* @param config - Bundled payload source and Harness-home installation root.
*/
async function apply(ctx, config) {
	await ctx.plugin(workspaceDependencies, config);
	const archive = runtimeArchivePath(config.runtimeDir) === void 0 ? void 0 : dirname(realpathSync(config.runtimeDir));
	const manifest = fileURLToPath(import.meta.resolve("@deepseek-ai/libreoffice-kit/package.json"));
	const packageRoot = dirname(archive === void 0 ? manifest : join(`${archive}.unpacked`, relative(archive, manifest)));
	await ctx.plugin(officeSkills, {
		assetRoot: join(dirname(config.source), "office-skills"),
		node: join(config.source, "dependencies", "node", "bin", process.platform === "win32" ? "node.exe" : "node"),
		cli: join(packageRoot, "lib", "cli.js")
	});
}
//#endregion
//#region lib/types/update-tasks.js
/** Desktop installation admission and task inspection for the shared Web Host. */
/**
* Whether stopping the Host now would interrupt work: a generating or tool-running
* agent (including subagents and turns waiting for approval), queued inbox
* messages, or a running or stopping background job.
* @param liveAgents - Current agent roster.
* @param jobs - Job registry queried for the global roster and each agent's own jobs.
* @returns true when any of those conditions holds.
*/
function hasDesktopActiveTasks(liveAgents, jobs) {
	return liveAgents.some((agent) => agent.status === "running" || agent.inbox.nextTurn.length > 0 || agent.inbox.nextStep.length > 0) || [void 0, ...liveAgents].some((agent) => jobs.list(agent?.id).some((job) => job.status === "running" || job.status === "stopping"));
}
/**
* Register update admission on the owning Host context.
* @param ctx - Booted Desktop profile context; disposal removes the request listener.
* @returns Task inspector whose lock refuses new API requests, drains admitted requests, and rechecks work.
*/
function installDesktopUpdateTaskControl(ctx) {
	let locked = false;
	let lockGeneration = 0;
	let stopped = false;
	ctx.effect(() => () => {
		stopped = true;
	});
	const pendingRequests = /* @__PURE__ */ new Set();
	ctx.on("connection/request", async (_request, response, next) => {
		if (locked) {
			response.writeHead(503);
			response.end();
			return;
		}
		const finished = Promise.withResolvers();
		pendingRequests.add(finished.promise);
		try {
			await next();
		} finally {
			pendingRequests.delete(finished.promise);
			finished.resolve();
		}
	});
	return async (action) => {
		if (stopped) throw new Error("desktop update: Host is stopping");
		if (action === "unlock") {
			locked = false;
			lockGeneration++;
		}
		const agents = ctx.get("agents");
		const jobs = ctx.get("jobs");
		if (agents === void 0 || jobs === void 0) throw new Error("desktop update: task services are unavailable");
		if (action === "lock") {
			locked = true;
			const generation = ++lockGeneration;
			await Promise.all(pendingRequests);
			if (stopped) throw new Error("desktop update: Host is stopping");
			if (generation !== lockGeneration) throw new Error("desktop update: admission lock was superseded");
		}
		return hasDesktopActiveTasks(agents.list(), jobs);
	};
}
//#endregion
//#region lib/types/quit-inspection.js
/** Quit-time inspection of interruptible work and armed scheduled reminders for the Electron shell. */
/**
* Register the quit inspector on the owning Host context.
* @param ctx - Booted Desktop profile context; disposal makes the inspector reject.
* @returns Inspector reporting active tasks together with armed reminders of the loaded sessions
*   (the `schedule` family of `workspace/session-activity`); reminders in sessions that were never
*   loaded during this run cannot fire and are not counted.
*/
function installDesktopQuitInspection(ctx) {
	let stopped = false;
	ctx.effect(() => () => {
		stopped = true;
	});
	return async () => {
		if (stopped) throw new Error("desktop quit: Host is stopping");
		const agents = ctx.get("agents");
		const jobs = ctx.get("jobs");
		if (agents === void 0 || jobs === void 0) throw new Error("desktop quit: task services are unavailable");
		const liveAgents = agents.list();
		const activeTasks = hasDesktopActiveTasks(liveAgents, jobs);
		let scheduledTasks = false;
		for (const agent of liveAgents) if ((await ctx.waterfall("workspace/session-activity", { sessionId: agent.id }, () => Promise.resolve([]))).some((entry) => entry.kind === "schedule")) {
			scheduledTasks = true;
			break;
		}
		return {
			activeTasks,
			scheduledTasks
		};
	};
}
//#endregion
//#region lib/types/platform-session.js
/**
* Publish account sessions for each provider lifetime, clearing them on removal or stream termination.
* @param ctx - Host context owning the account dependency subscription.
* @param publish - Synchronous private IPC delivery; never forwards credentials to the renderer.
*/
function installPlatformSessionPublisher(ctx, publish) {
	ctx.inject(["deepseekAccount"], (accountCtx) => {
		const account = accountCtx.deepseekAccount;
		accountCtx.effect(() => {
			const lifetime = new AbortController();
			const updates = (async () => {
				try {
					for await (const _state of account.watch(lifetime.signal)) {
						if (lifetime.signal.aborted) break;
						const session = await account.getPlatformSession();
						if (!lifetime.signal.aborted) publish(session);
					}
				} catch {
					if (!lifetime.signal.aborted) accountCtx.logger("desktop-platform").warn("Account session subscription failed");
				} finally {
					if (!lifetime.signal.aborted) publish(null);
				}
			})();
			return async () => {
				lifetime.abort();
				publish(null);
				await updates;
			};
		});
	});
}
//#endregion
//#region lib/types/index.js
/** Launch the Desktop profile through the Web application and report its URL to Electron. */
async function main() {
	const runtimeDir = process.argv[2];
	const projectDir = process.argv[3];
	installOfficeEngineResolution(runtimeDir);
	const installAnchor = join(runtimeDir, "node_modules", "@deepseek-ai", "dsh", "package.json");
	const profile = loadProfileDirectory("dsh", projectDir, installAnchor);
	reportSkippedBundles("dsh", profile);
	const application = runProfile({
		environment: loadLayeredEnv("dsh"),
		profile: "desktop",
		resolvedProfile: {
			profile,
			installAnchor
		},
		patchFiles: [],
		args: [
			"--no-open",
			"--port",
			"19387"
		],
		...process.argv[5] === void 0 ? {} : { packageManager: {
			command: process.execPath,
			args: ["--expose-internals", process.argv[5]],
			env: {
				ELECTRON_RUN_AS_NODE: "1",
				DSH_DESKTOP_NODE_EXECUTABLE: process.execPath,
				PATH: `${process.argv[6] ?? ""}${delimiter}${process.env.PATH ?? ""}`
			}
		} }
	});
	let stopping;
	const control = {};
	const send = (message) => new Promise((resolve, reject) => {
		if (!process.connected || process.send === void 0) {
			resolve();
			return;
		}
		process.send(message, (error) => {
			if (error === null) resolve();
			else reject(error);
		});
	});
	const stop = () => stopping ??= (async () => {
		await (await application.catch(() => void 0))?.shutdown.shutdown(0);
		await send({ type: "shutdown-complete" });
		if (process.connected) process.disconnect();
	})();
	process.on("message", (message) => {
		if (typeof message !== "object" || message === null || !("type" in message)) return;
		if (message.type === "shutdown") {
			stop();
			return;
		}
		if (message.type === "quit-inspection") {
			if (!("requestId" in message) || !Number.isSafeInteger(message.requestId)) return;
			const requestId = message.requestId;
			(async () => {
				try {
					if (stopping !== void 0 || control.quitInspection === void 0) throw new Error("desktop quit: Host is unavailable");
					await send({
						type: "quit-inspection",
						requestId,
						...await control.quitInspection()
					});
				} catch (error) {
					await send({
						type: "quit-inspection",
						requestId,
						activeTasks: true,
						scheduledTasks: false,
						error: error instanceof Error ? error.message : String(error)
					});
				}
			})().catch((error) => {
				console.error(error);
			});
			return;
		}
		if (message.type !== "update-tasks" || !("requestId" in message) || !Number.isSafeInteger(message.requestId) || !("action" in message) || ![
			"inspect",
			"lock",
			"unlock"
		].includes(String(message.action))) return;
		(async () => {
			try {
				if (stopping !== void 0 || control.updateTasks === void 0) throw new Error("desktop update: Host is unavailable");
				const active = await control.updateTasks(message.action);
				await send({
					type: "update-tasks",
					requestId: message.requestId,
					active
				});
			} catch (error) {
				await send({
					type: "update-tasks",
					requestId: message.requestId,
					active: true,
					error: error instanceof Error ? error.message : String(error)
				});
			}
		})().catch((error) => {
			console.error(error);
		});
	});
	process.once("disconnect", () => {
		stop();
	});
	const { ctx } = await application;
	control.updateTasks = installDesktopUpdateTaskControl(ctx);
	control.quitInspection = installDesktopQuitInspection(ctx);
	await ctx.plugin(office_exports, {
		runtimeDir,
		source: process.argv[4] ?? join(runtimeDir, "..", "runtime", "primary-runtime"),
		root: join(resolveDshHome(), "dsh-runtimes", "dsh-primary-runtime")
	});
	installPlatformSessionPublisher(ctx, (session) => {
		if (process.connected) process.send?.({
			type: "platform-session",
			session
		});
	});
	const url = ctx.connection.authenticatedUrl(`http://127.0.0.1:${String(ctx.webServer.port)}`);
	if (process.connected) process.send?.({
		type: "ready",
		url,
		injections: ctx.webServer.collectIndexInjections()
	}, (error) => {
		if (error !== null) console.error(error);
	});
}
/** Upper bound of the startup diagnostic carried over IPC; the head holds the message and stack. */
const MAX_FATAL_DIAGNOSTIC_CHARS = 64 * 1024;
if (import.meta.main) main().catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	const diagnostic = inspect(error, {
		depth: 4,
		maxArrayLength: 50
	}).slice(0, MAX_FATAL_DIAGNOSTIC_CHARS);
	if (process.connected) process.send?.({
		type: "fatal",
		message,
		diagnostic
	}, (error) => {
		if (error !== null) console.error(error);
	});
	console.error(error);
	process.exitCode = 1;
	if (process.connected) process.disconnect();
});
//#endregion
export {};
