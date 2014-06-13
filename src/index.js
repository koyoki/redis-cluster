var redis = require("redis");
var crc16 = require("./crc16.js");
var commands = require("./commands.js");
var Multi = require("./multi.js");

var hashSlots = 16384;

function RedisCluster(nodes, redisOptions, callback) {
    this.nodes = [];
    for (var i = 0; i < nodes.length; ++i) {
        this.addNode(nodes[i]);
    }
    this.connections = {};
    this.redisOptions = redisOptions;
    this.initializeSlotsCache(callback);
    this.bindCommands();
}

RedisCluster.prototype.getRedisLink = function (host, port, callback) {
    //console.log("Connecting to " + host + ":" + port);
    var client = redis.createClient(port, host, this.redisOptions);
    client.once("ready", function () {
        client.removeAllListeners("error");
        callback(null, client);
    });
    client.once("error", function (err) {
        var parts = err.message.split(" ");
        if (parts[parts.length - 1] === "ECONNREFUSED") {
            callback(err);
        }
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

RedisCluster.prototype.initializeSlotsCache = function (callback) {
    this.slots = [];
    var node = this.nodes.shift();
    if (node === undefined) {
        if (callback) {
            callback(new Error("Could not connect to cluster"));
        }
        return;
    }

    var that = this;
    this.getRedisLink(node.host, node.port, function (err, r) {
        if (err) {
            //console.log("Could not connect to redis server " + node.host + ":" + node.port);
            //console.error(err.stack);
            that.initializeSlotsCache(callback);
            return;
        }

        r.cluster("nodes", function (err, res) {
            r.quit();

            if (err) {
                that.initializeSlotsCache(callback);
                return;
            }

            that.refreshTable = false;
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
                that.addNode(addr);

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
                        that.slots[k] = addr;
                    }
                }
            }

            //console.log("Found " + that.nodes.length + " nodes in cluster");
            if (callback) {
                callback(null);
            }
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

RedisCluster.prototype.getKeyFromCommand = function () {
    var cmd = arguments[0].toLowerCase();
    if (["info", "multi", "exec", "slaveof", "config", "shutdown"].indexOf(cmd) !== -1) {
        return null;
    } else {
        var key = arguments[1];
        if (Array.isArray(key)) {
            return key[0];
        }
        return key;
    }
};

RedisCluster.prototype.getRandomConnection = function (callback) {
    var that = this;
    var node = this.nodes.shift();

    if (node === undefined) {
        callback("Can't reach a single startup node.");
        return;
    }

    this.nodes.push(node);
    this.getConnection(node, function (err, conn) {
        if (err) {
            that.getRandomConnection(callback);
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

    var that = this;
    this.getConnection(node, function (err, conn) {
        if (err) {
            that.getRandomConnection(callback);
            return;
        }

        callback(null, conn);
    });
};

RedisCluster.prototype.getConnection = function (node, callback) {
    var that = this;
    var name = node.host + ":" + node.port;
    if (!this.connections[name]) {
        this.getRedisLink(node.host, node.port, function (err, conn) {
            if (err) {
                callback(err);
                return;
            }

            that.connections[name] = conn;
            callback(null, conn);
        });
    } else {
        callback(null, this.connections[name]);
    }
};

RedisCluster.prototype.sendClusterCommand = function () {
    var args = Array.prototype.slice.call(arguments, 0);
    var that = this;
    if (this.refreshTable) {
        this.initializeSlotsCache(function () {
            that.sendClusterCommand.apply(that, args);
        });
        return;
    }

    var key = this.getKeyFromCommand.apply(this, args);
    var slot = this.getSlot(key);
    this.getConnectionBySlot(slot, function (err, conn) {
        if (err) {
            console.error("Could not get connection to a cluster node: " + err.toString());
            return;
        }

        var callback = args[args.length - 1];
        if (typeof callback === "function") {
            args[args.length - 1] = function (err, res) {
                if (err) {
                    var parts = err.toString().split(" ");
                    if (parts[1] === "MOVED" || parts[1] === "ASK") {
                        that.refreshTable = true;
                        that.sendClusterCommand.apply(that, args);
                        return;
                    }
                    callback(err);
                    return;
                }

                callback(null, res);
            };
        }
        var command = [args.shift(), args];
        conn.send_command.apply(conn, command);
    });
};

RedisCluster.prototype.bindCommands = function () {
    var that = this;

    commands.forEach(function (command) {
        if (command === "multi" || command === "exec") {
            return;
        }

        RedisCluster.prototype[command] = function () {
            var args = Array.prototype.slice.call(arguments, 0);
            args.unshift(command);
            that.sendClusterCommand.apply(that, args);
        };

        RedisCluster.prototype[command.toUpperCase()] = RedisCluster.prototype[command];
    });
};

RedisCluster.prototype.multi = function () {
    return new Multi(this);
};

exports.createClient = function (port, host, options, callback) {
    port = port || 6379;
    host = host || "127.0.0.1";
    return new RedisCluster([{"host": host, "port": port}], options, callback);
};

exports.Cluster = RedisCluster;
