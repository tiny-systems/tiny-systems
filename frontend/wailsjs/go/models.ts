export namespace fleet {
	
	export class NodeHealth {
	    name: string;
	    ready: boolean;
	    diskPressure: boolean;
	    memoryPressure: boolean;
	    diskFreeGB: number;
	    diskTotalGB: number;
	
	    static createFrom(source: any = {}) {
	        return new NodeHealth(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.ready = source["ready"];
	        this.diskPressure = source["diskPressure"];
	        this.memoryPressure = source["memoryPressure"];
	        this.diskFreeGB = source["diskFreeGB"];
	        this.diskTotalGB = source["diskTotalGB"];
	    }
	}
	export class Health {
	    nodes: NodeHealth[];
	    runtimeMissing?: string[];
	    signIn: string;
	    codex: boolean;
	    sandbox?: string;
	    sandboxAvailable: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Health(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.nodes = this.convertValues(source["nodes"], NodeHealth);
	        this.runtimeMissing = source["runtimeMissing"];
	        this.signIn = source["signIn"];
	        this.codex = source["codex"];
	        this.sandbox = source["sandbox"];
	        this.sandboxAvailable = source["sandboxAvailable"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace main {
	
	export class Asking {
	    name: string;
	    session?: string;
	    text: string;
	    options?: string[];
	    idle: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Asking(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.session = source["session"];
	        this.text = source["text"];
	        this.options = source["options"];
	        this.idle = source["idle"];
	    }
	}
	export class Row {
	    name: string;
	    parent?: string;
	    depth: number;
	    phase: string;
	    glyph: string;
	    title: string;
	    activity: string;
	    message: string;
	    task: string;
	    cpu: string;
	    mem: string;
	    age: string;
	    paused: boolean;
	    command: boolean;
	    question?: Asking;
	    exit?: number;
	    attachable: boolean;
	    tags?: string[];
	    stage?: string;
	
	    static createFrom(source: any = {}) {
	        return new Row(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.parent = source["parent"];
	        this.depth = source["depth"];
	        this.phase = source["phase"];
	        this.glyph = source["glyph"];
	        this.title = source["title"];
	        this.activity = source["activity"];
	        this.message = source["message"];
	        this.task = source["task"];
	        this.cpu = source["cpu"];
	        this.mem = source["mem"];
	        this.age = source["age"];
	        this.paused = source["paused"];
	        this.command = source["command"];
	        this.question = this.convertValues(source["question"], Asking);
	        this.exit = source["exit"];
	        this.attachable = source["attachable"];
	        this.tags = source["tags"];
	        this.stage = source["stage"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Target {
	    name: string;
	    context: string;
	    namespace: string;
	
	    static createFrom(source: any = {}) {
	        return new Target(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.context = source["context"];
	        this.namespace = source["namespace"];
	    }
	}
	export class Fleet {
	    target: Target;
	    rows: Row[];
	    loose?: Asking[];
	    readAt: string;
	    needsYou: number;
	    running: number;
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new Fleet(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.target = this.convertValues(source["target"], Target);
	        this.rows = this.convertValues(source["rows"], Row);
	        this.loose = this.convertValues(source["loose"], Asking);
	        this.readAt = source["readAt"];
	        this.needsYou = source["needsYou"];
	        this.running = source["running"];
	        this.error = source["error"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Garden {
	    target: Target;
	    where: string;
	    local: boolean;
	    vmStatus: string;
	
	    static createFrom(source: any = {}) {
	        return new Garden(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.target = this.convertValues(source["target"], Target);
	        this.where = source["where"];
	        this.local = source["local"];
	        this.vmStatus = source["vmStatus"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class InstallRequest {
	    name: string;
	    host: string;
	    port: number;
	    user: string;
	    keyFile: string;
	    password: string;
	    sudoPassword: string;
	    namespace: string;
	    gvisor: boolean;
	    apiPort: number;
	    trustFingerprint: string;
	    copyFrom?: Target;
	    token?: string;
	
	    static createFrom(source: any = {}) {
	        return new InstallRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.host = source["host"];
	        this.port = source["port"];
	        this.user = source["user"];
	        this.keyFile = source["keyFile"];
	        this.password = source["password"];
	        this.sudoPassword = source["sudoPassword"];
	        this.namespace = source["namespace"];
	        this.gvisor = source["gvisor"];
	        this.apiPort = source["apiPort"];
	        this.trustFingerprint = source["trustFingerprint"];
	        this.copyFrom = this.convertValues(source["copyFrom"], Target);
	        this.token = source["token"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class LocalInstallRequest {
	    name: string;
	    cpus: number;
	    memoryGB: number;
	    diskGB: number;
	    gvisor: boolean;
	    copyFrom?: Target;
	    token?: string;
	
	    static createFrom(source: any = {}) {
	        return new LocalInstallRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.cpus = source["cpus"];
	        this.memoryGB = source["memoryGB"];
	        this.diskGB = source["diskGB"];
	        this.gvisor = source["gvisor"];
	        this.copyFrom = this.convertValues(source["copyFrom"], Target);
	        this.token = source["token"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class VM {
	    name: string;
	    status: string;
	
	    static createFrom(source: any = {}) {
	        return new VM(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.status = source["status"];
	    }
	}
	export class LocalStatus {
	    lima: boolean;
	    vms: VM[];
	    hint?: string;
	
	    static createFrom(source: any = {}) {
	        return new LocalStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.lima = source["lima"];
	        this.vms = this.convertValues(source["vms"], VM);
	        this.hint = source["hint"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Message {
	    from: string;
	    text: string;
	    at: string;
	    question?: string;
	    options?: string[];
	    answer?: string;
	    open?: boolean;
	    idle?: boolean;
	    file?: string;
	
	    static createFrom(source: any = {}) {
	        return new Message(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.from = source["from"];
	        this.text = source["text"];
	        this.at = source["at"];
	        this.question = source["question"];
	        this.options = source["options"];
	        this.answer = source["answer"];
	        this.open = source["open"];
	        this.idle = source["idle"];
	        this.file = source["file"];
	    }
	}
	export class NewSessionRequest {
	    task: string;
	    repo: string;
	    agent: string;
	    model: string;
	    image: string;
	
	    static createFrom(source: any = {}) {
	        return new NewSessionRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.task = source["task"];
	        this.repo = source["repo"];
	        this.agent = source["agent"];
	        this.model = source["model"];
	        this.image = source["image"];
	    }
	}
	
	export class Settings {
	    startVMs: boolean;
	    openAtLogin: boolean;
	    checkUpdates: boolean;
	    autoUpdate: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Settings(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.startVMs = source["startVMs"];
	        this.openAtLogin = source["openAtLogin"];
	        this.checkUpdates = source["checkUpdates"];
	        this.autoUpdate = source["autoUpdate"];
	    }
	}
	export class ShownFile {
	    name: string;
	    type: string;
	    data: string;
	    size: number;
	
	    static createFrom(source: any = {}) {
	        return new ShownFile(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.type = source["type"];
	        this.data = source["data"];
	        this.size = source["size"];
	    }
	}
	
	export class Update {
	    available: boolean;
	    version?: string;
	    url?: string;
	    notes?: string;
	
	    static createFrom(source: any = {}) {
	        return new Update(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.available = source["available"];
	        this.version = source["version"];
	        this.url = source["url"];
	        this.notes = source["notes"];
	    }
	}

}

