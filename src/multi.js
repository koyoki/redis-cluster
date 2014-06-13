var commands = require("./commands.js");

function Multi(cluster) {
    this.cluster = cluster;
    this.buffer = [];

    this.bindCommands();
}

Multi.prototype.bindCommands = function () {
    var that = this;

    commands.forEach(function (command) {
        if (command === "multi" || command === "exec") {
            return;
        }

        Multi.prototype[command] = function () {
            if (that.invalid) {
                return this;
            }

            var args = Array.prototype.slice.call(arguments, 0);
            args.unshift(command);

            //Check the slot is the same
            var key = that.cluster.getKeyFromCommand.apply(that.cluster, args);
            var slot = that.cluster.getSlot(key);
            if (that.slot === undefined) {
                that.slot = slot;
            } else if (slot !== that.slot) {
                that.invalid = true;
                return;
            }

            that.buffer.push(args);
            return this;
        };

        Multi.prototype[command.toUpperCase()] = Multi.prototype[command];
    });
};

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
