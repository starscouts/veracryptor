const si = require('systeminformation');
const cp = require('child_process');

(async () => {
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

    global.roots = await si.blockDevices();
    global.disks = await si.diskLayout();

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

    console.log(mounted);
})();
