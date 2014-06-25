var commands = require("./commands.js");

function Multi(cluster) {
    this.cluster = cluster;
    this.buffer = [];
}

commands.forEach(function (command) {
    if (command === "multi" || command === "exec") {
        return;
    }

    Multi.prototype[command] = function (args, callback) {
        if (this.invalid) {
            return this;
        }

        //Check the slot is the same
        var key = args;
        if (Array.isArray(args)) {
            key = args[0];
        }

        var slot = this.cluster.getSlot(key);
        if (this.slot === undefined) {
            this.slot = slot;
        } else if (slot !== this.slot) {
            this.invalid = true;
            return;
        }

        if (Array.isArray(args) && typeof callback === "function") {
            this.buffer.push([command, args, callback]);
        } else {
            args = Array.prototype.slice.call(arguments, 0);
            this.buffer.push([command, args]);
        }

        return this;
    };

    Multi.prototype[command.toUpperCase()] = Multi.prototype[command];
});

Multi.prototype.exec = function (callback) {
    if (this.invalid) {
        callback(new Error("Multi commands must operate on the same slot!"));
        return;
    }

    var that = this;
    this.cluster.getConnectionBySlot(this.slot, function (err, conn) {
        if (err) {
            console.error(err);
            return;
        }

        var multi = conn.multi();
        for (var i = 0; i < that.buffer.length; ++i) {
            var args = that.buffer[i];
            var command = args.shift();
            multi[command].apply(multi, args);
        }

        multi.exec(callback);
    });
};

Multi.prototype.EXEC = Multi.prototype.exec;

module.exports = Multi;
