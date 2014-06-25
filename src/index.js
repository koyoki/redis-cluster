var util = require("util");
var events = require("events");
var redis = require("redis");
var crc16 = require("./crc16.js");
var commands = require("./commands.js");
var Multi = require("./multi.js");

var hashSlots = 16384;
var emptyCallback = function () {};

function RedisCluster(nodes, redisOptions) {
    this.ready = false;
    this.nodes = [];
    for (var i = 0; i < nodes.length; ++i) {
        this.addNode(nodes[i]);
    }
    this.connections = {};
    this.redisOptions = redisOptions;
    this.initializeSlotsCache();

    events.EventEmitter.call(this);
}
util.inherits(RedisCluster, events.EventEmitter);

RedisCluster.prototype.getRedisLink = function (host, port, callback) {
    //console.log("Connecting to " + host + ":" + port);
    var self = this;
    var client = redis.createClient(port, host, this.redisOptions);
    client.once("ready", function () {
        client.removeAllListeners("error");
        callback(null, client);
    });
    client.on("error", function (err) {
        var parts = err.message.split(" ");
        if (parts[parts.length - 1] === "ECONNREFUSED") {
            callback(err);
        }
        self.emit("redis_error", err);
    });
    client.on("message", function (channel, message) {
        self.emit("message", channel, message);
    });
};

RedisCluster.prototype.addNode = function (node) {
    for (var i = 0; i < this.nodes.length; ++i) {
        var n = this.nodes[i];
        if (n.host === node.host && n.port === node.port) {
            return;
        }
    }

    //console.log("Added node " + node.host + ":" + node.port);
    this.nodes.push(node);
};

RedisCluster.prototype.initializeSlotsCache = function () {
    this.slots = [];
    this.ready = false;

    var node = this.nodes.shift();
    if (node === undefined) {
        this.emit("error", new Error("Could not connect to cluster"));
        return;
    }

    var self = this;
    this.getRedisLink(node.host, node.port, function (err, r) {
        if (err) {
            //console.log("Could not connect to redis server " + node.host + ":" + node.port);
            //Try again with next node
            self.initializeSlotsCache();
            return;
        }

        r.cluster("nodes", function (err, res) {
            r.quit();

            if (err) {
                //Try again with next node
                self.initializeSlotsCache();
                return;
            }

            self.refreshTable = false;
            var lines = res.split("\n");

            for (var i = 0; i < lines.length; ++i) {
                if (lines[i].trim().length === 0) {
                    continue;
                }

                //Add cluster nodes
                var fields = lines[i].split(" ");
                var addr = fields[1];
                var parts = addr.split(":");
                if (addr === ":0") {
                    addr = {"host": node.host, "port": node.port};
                } else {
                    addr = {"host": parts[0], "port": parts[1]};
                }
                self.addNode(addr);

                //Update slot mappings
                var slots = fields.slice(8);
                for (var j = 0; j < slots.length; ++j) {
                    var range = slots[j];
                    if (range[0] === "[") {
                        continue;
                    }

                    parts = range.split("-");
                    var first = parseInt(parts[0], 10);
                    var last = parseInt(parts[1], 10) || first;
                    for (var k = first; k < last; ++k) {
                        self.slots[k] = addr;
                    }
                }
            }

            //console.log("Found " + self.nodes.length + " nodes in cluster");
            self.emit("ready");
            self.ready = true;
        });
    });
};

RedisCluster.prototype.getSlot = function (key) {
    var s = key.indexOf("{");
    if (s !== -1) {
        var e = key.indexOf("}", s+1);
        if (e > s+1) {
            key = key.substring(s+1, e);
        }
    }
    return crc16(key) % hashSlots;
};

RedisCluster.prototype.getRandomConnection = function (callback) {
    var self = this;
    var node = this.nodes.shift();

    if (node === undefined) {
        callback("Can't reach a single startup node.");
        return;
    }

    this.nodes.push(node);
    this.getConnection(node, function (err, conn) {
        if (err) {
            self.getRandomConnection(callback);
            return;
        }

        callback(null, conn);
    });
};

RedisCluster.prototype.getConnectionBySlot = function (slot, callback) {
    var node = this.slots[slot];
    if (!node) {
        this.getRandomConnection(callback);
        return;
    }

    var self = this;
    this.getConnection(node, function (err, conn) {
        if (err) {
            self.getRandomConnection(callback);
            return;
        }

        callback(null, conn);
    });
};

RedisCluster.prototype.getConnection = function (node, callback) {
    var self = this;
    var name = node.host + ":" + node.port;
    if (!this.connections[name]) {
        this.getRedisLink(node.host, node.port, function (err, conn) {
            if (err) {
                callback(err);
                return;
            }

            self.connections[name] = conn;
            callback(null, conn);
        });
    } else {
        callback(null, this.connections[name]);
    }
};

RedisCluster.prototype.sendClusterCommand = function (command, args, callback) {
    var self = this;
    if (this.refreshTable) {
        this.initializeSlotsCache();
        this.once("ready", function () {
            var argsArray = Array.prototype.slice.call(arguments, 0);
            self.sendClusterCommand.apply(self, argsArray);
        });
        return;
    }

    var key = args[0];
    var slot = this.getSlot(key);
    this.getConnectionBySlot(slot, function (err, conn) {
        if (err) {
            console.error("Could not get connection to a cluster node: " + err.toString());
            return;
        }

        var cb = callback;
        if (!cb) {
            var lastArgType = typeof args[args.length - 1];
            if (lastArgType === "function") {
                cb = args.pop();
            } else {
                cb = emptyCallback;
            }
        }

        callback = function (err, res) {
            if (err) {
                var parts = err.toString().split(" ");
                if (parts[1] === "MOVED" || parts[1] === "ASK") {
                    self.refreshTable = true;
                    self.sendClusterCommand.apply(self, args);
                    return;
                }
                cb(err);
                return;
            }

            cb(null, res);
        };

        conn.send_command.call(conn, command, args, callback);
    });
};

commands.forEach(function (command) {
    if (command === "multi" || command === "exec") {
        return;
    }

    RedisCluster.prototype[command] = function (args, callback) {
        if (Array.isArray(args) && typeof callback === "function") {
            this.sendClusterCommand(command, args, callback);
        } else {
            args = Array.prototype.slice.call(arguments, 0);
            this.sendClusterCommand(command, args);
        }
    };

    RedisCluster.prototype[command.toUpperCase()] = RedisCluster.prototype[command];
});

RedisCluster.prototype.multi = function () {
    return new Multi(this);
};

RedisCluster.prototype.quit = function () {
    for (var node in this.connections) {
        if (this.connections.hasOwnProperty(node)) {
            this.connections[node].quit();
        }
    }
};

exports.getSlot = function getSlot(key) {
    var s = key.indexOf("{");
    if (s !== -1) {
        var e = key.indexOf("}", s+1);
        if (e > s+1) {
            key = key.substring(s+1, e);
        }
    }
    return crc16(key) % hashSlots;
};
RedisCluster.prototype.getSlot = exports.getSlot;

exports.createClient = function (port, host, options) {
    port = port || 6379;
    host = host || "127.0.0.1";
    return new RedisCluster([{"host": host, "port": port}], options);
};

exports.Cluster = RedisCluster;
