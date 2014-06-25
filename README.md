# redis-party

A redis client wrapper to support cluster connections.

This library can be used as a drop-in replacement for the regular node\_redis client.

## Install

    npm install redis-party

## Example

```javascript
var nodes = [
    {"host": "node1.domain.com", "port": 10000},
    {"host": "node1.domain.com", "port": 10001},
    {"host": "node2.domain.com", "port": 10000},
    {"host": "node2.domain.com", "port": 10001},
];
var redis = require("redis-party");

var cluster = new redis.Cluster(nodes, {"max_attempts": 5});
cluster.once("ready", function () {
    cluster.SET("hello", "planet");

    var multi = cluster.multi();
    multi.SET("hello", "world");
    multi.GET("hello");
    multi.DEL("hello");
    multi.exec(function (err, res) {
        console.log("hello " + res[1]);
    });

    var multi2 = cluster.multi();
    multi2.SET("key1", "val");
    multi2.SET("key2", "val");
    multi2.exec(function (err, res) {
        //err = Error("Multi comands must operate on the same slot!")
    });

    cluster.PUBLISH("key1", "hello world!");
});
```

Alternative node\_redis compatible interface:

```javascript
var client = redis.createClient(port, host, options);
client.SET("foo", "bar", function () {
    client.GET("foo", function (err, bar) {
        console.log("foo = " + bar);
    });
});
```

### Sending Commands

Just like node\_redis, each redis command is exposed as a function on the client object.

All commands except `multi` are passed along to the correct node\_redis client depending on the key hash.

## API

### Client Events

#### ready

The client will emit the ready event once the client is connected to the cluster and has populated the slot-node mapping table.

#### error

This client will emit the error event if there is an error with the cluster library.

#### redis\_error

Error events emitted from the node\_redis library.

#### message (channel, message)

Client will emit `message` for every message received that matches an active subscription.

### cluster.createClient(port, host, options, [callback])

Create a new cluster instance. It will connect to the specified redis node and discover the rest of the nodes from there.

* `port` - defaults to `6379`
* `host` - defaults to `127.0.0.1`
* `options` - same as node\_redis client options

### cluster.Cluster(nodes, redisOptions, callback)

Create a new cluster instance. It will connect to the first available redis node and discover the rest of the nodes from there.

* `nodes` - an array of objects with `host` and `port` properties.
* `redisOptions` - node\_redis client options. See [node\_redis](https://github.com/mranney/node_redis) documentation.

### client.quit()

Cleanly end connections to all cluster nodes by sending the `QUIT` command after handling all replies.

### client.getSlot(key)

Returns the slot which will be used for a key.

### client.getConnectionBySlot(slot, callback)

Get the node\_redis instance for a specific slot.
