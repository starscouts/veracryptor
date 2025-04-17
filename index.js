const si = require('systeminformation');
const cp = require('child_process');
const os = require('os');
const {existsSync} = require("node:fs");

function convertDevicePath(path) {
    if (!path.startsWith("\\\\.\\")) return path;
    let parts = path.trim().split("\\").filter(i => i.trim() !== "").slice(1);
    return "\\Device\\Harddisk" + parts[0].substring(13) + "\\Partition0";
}

if (os.platform() === "darwin") {
    const keychain = require('keychain');

    function savePassword(disk, password) {
        return new Promise((res, rej) => {
            keychain.setPassword({ account: disk, service: "VeraCrypt", password }, (err) => {
                if (err) rej(err);
                res();
            })
        })
    }

    function getPassword(disk) {
        return new Promise((res, rej) => {
            keychain.getPassword({ account: disk, service: "VeraCrypt" }, (err, password) => {
                if (err) rej(err);
                res(password);
            })
        })
    }
}

const blocked = {};
const mounting = {};
const config = require('fs').readFileSync("./veratab")
    .toString().trim()
    .split("\n")
    .filter(i => !i.trim().startsWith("#"))
    .map(i => i.trim()
        .replaceAll("\t", "|")
        .replace(/\|+/g, "|")
        .split("|")
    )
    .map(i => {
        let obj = {
            root: null,
            letter: null,
            mount: null
        };

        obj['root'] = i[0];
        obj['letter'] = i[1] ? i[1].toUpperCase().replace(/[^A-Z]/g, "").substring(0, 1) : null;
        return obj;
    });

global.disks = [];
global.roots = [];

function getMounted() {
    let mounted = [];

    if (os.platform() === "win32") {
        for (let entry of config) {
            if (existsSync(entry.letter + ":\\")) {
                mounted.push({
                    slot: null,
                    source: entry.file,
                    raw: entry.root,
                    target: entry.letter + ":\\",
                    mount: entry.letter + ":\\"
                });
            }
        }
    } else {
        try {
            mounted = cp.execSync("veracrypt -t -l")
                .toString().trim()
                .split("\n")
                .map(i => i.split(" "))
                .map(i => {
                    return {
                        slot: i[0],
                        source: i[1],
                        raw: config
                            .map(i => {
                                if (i.root.startsWith("@")) {
                                    return [i.root.substring(1), i.root];
                                } else {
                                    let item = roots.find($ => eval(i.root)) ?? disks.find($ => eval(i.root)) ?? null;
                                    if (item) item = item["name"].startsWith("/") ? item["name"] : "/dev/" + item["device"]
                                    return [item, i.root];
                                }
                            })
                            .filter(j => j[0] === i[1])[0][1],
                        target: i[2],
                        mount: i[3] !== "-" ? i[3] : null
                    }
                });
        } catch (e) {}
    }

    return mounted;
}

async function main() {
    global.roots = await si.blockDevices();
    global.disks = await si.diskLayout();
    let mounted = getMounted();

    console.log(mounted, blocked, mounting);

    for (let volume of mounted) {
        if (!volume.source || !volume.raw || (!existsSync(volume.source) && volume.raw.startsWith("@"))) {
            if (os.platform() === "win32") {
                cp.execSync(`"C:\\Program Files\\VeraCrypt\\VeraCrypt.exe" /q /protectMemory /d ${volume.target}`, { stdio: "inherit" });
            } else {
                cp.execSync(`veracrypt -t -d ${volume.target}`, { stdio: "inherit" });
            }
        }

        if (!volume.mount) {
            if (!blocked[volume.raw]) {
                try {
                    if (os.platform() === "win32") {
                        // noinspection ExceptionCaughtLocallyJS
                        throw new Error("Incoherent data.");
                    } else {
                        cp.execSync("veracrypt -t -d " + volume.source);
                    }

                    blocked[volume.raw] = true;
                } catch (e) {
                    console.error(e);
                }
            }
        }
    }

    for (let entry of config) {
        if (entry.root.startsWith("@")) {
            entry.file = entry.root.substring(1);
        } else {
            entry.file = roots.find($ => eval(entry.root)) ?? disks.find($ => eval(entry.root)) ?? null;
            if (os.platform() !== "win32") if (entry.file) entry.file = entry.file["name"].startsWith("/") ? entry.file["name"] : "/dev/" + entry.file["device"];
            if (os.platform() === "win32") if (entry.file) entry.file = convertDevicePath(entry.file["device"]);
        }

        console.log(entry.file);

        if (!entry.file || (!require('fs').existsSync(entry.file) && entry.root.startsWith("@"))) {
            delete blocked[entry.root];
            delete mounting[entry.root];
            continue;
        }

        if (!entry.file ||
            mounted.find(i => i.source === entry.file) ||
            blocked[entry.root] ||
            mounting[entry.root]) continue;
        mounting[entry.root] = true;

        await askForPassword(entry, true);
    }

    setTimeout(async () => {
        await main();
    }, 5000);
}

async function askForPassword(entry, allowSavedPassword) {
    let password;
    let savePasswordToKeychain = false;

    if (allowSavedPassword && os.platform() === "darwin") {
        let savedPassword;

        try {
            savedPassword = await getPassword(entry.root);
        } catch (e) {
            console.error(e);
        }

        if (savedPassword) {
            password = savedPassword;
        }
    }

    if (!entry.key && !password) {
        if (os.platform() === "darwin") {
            require('fs').writeFileSync("./password.workflow/Contents/document.wflow",
                require('fs').readFileSync("./password.workflow/Contents/document.pre.wflow").toString()
                    .replace("%NAME%", entry.file));
            password = cp.execSync("automator password.workflow").toString().trim();

            if (password === "") {
                blocked[entry.root] = true;
                mounting[entry.root] = false;
                return;
            }

            savePasswordToKeychain = JSON.parse(password.split("{button returned:")[1].split(",")[0]) === "Unlock and Save in Keychain";
            password = JSON.parse(password.split(", text returned:")[1].split("}")[0]);

            console.log(savePasswordToKeychain);
        } else if (os.platform() !== "win32") {
            throw new Error("Could not find a valid password backend.");
        }
    }

    try {
        if (os.platform() === "win32") {
            cp.execFileSync("C:\\Program Files\\VeraCrypt\\VeraCrypt.exe", [ "/q", "/protectMemory", "/v", entry.file, "/l", entry.letter ], { stdio: "inherit" });
        } else {
            if (entry.key) {
                cp.execSync(`echo " " | veracrypt -t --stdin -k "${entry.key.replaceAll('"', '\\"')}" --protect-hidden=no --non-interactive --mount '${entry.file.replaceAll("'", "\\''")}' ''`, { stdio: "inherit" });
            } else {
                cp.execSync(`echo ${JSON.stringify(password)} | veracrypt -t --stdin -k '' --protect-hidden=no --non-interactive --mount '${entry.file.replaceAll("'", "\\''")}' ''`, { stdio: "inherit" });
            }

            let mounted = getMounted();

            for (let volume of mounted) {
                if (!volume.mount) {
                    console.log(volume, entry.file);
                    if (volume.source === entry.file) {
                        cp.execSync("diskutil mount " + volume.target);
                        mounting[entry.root] = false;
                    }
                }
            }

            if (savePasswordToKeychain && os.platform() === "darwin") {
                await savePassword(entry.root, password);
            }
        }
    } catch (e) {
        if (os.platform() === "win32" && e.status === 1) {
            blocked[entry.root] = true;
            mounting[entry.root] = false;
            return;
        }

        console.error(e);
        await askForPassword(entry, false);
    }
}

(async () => {
    await main();
})();
