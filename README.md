# redis-party

A redis client wrapper to support cluster connections.

The cluster instance can be used as a drop-in replacement for the regular node\_redis client.

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
var cluster = require("redis-party");

var c = new cluster.Cluster(nodes, {"max_attempts": 5});
c.once("ready", function () {
    var multi = c.multi();
    multi.SET("hello", "world");
    multi.GET("hello");
    multi.DEL("hello");
    multi.exec(function (err, res) {
        console.log("hello = " + res[1]);
    });


    var multi2 = c.multi();
    multi2.SET("key1");
    multi2.SET("key2");
    multi2.exec(function (err, res) {
        //err = Error("Multi comands must operate on the same slot!")
    });
});
```

Alternative node\_redis compatible interface:

```javascript
var client = cluster.createClient(port, host, options);
client.SET("foo", "bar", function () {
    client.GET("foo", "bar", function (err, bar) {
        console.log("foo = " + bar);
    });
});
```

## API

### Client Events

#### ready

The client will emit the ready event once the client is connected to the cluster and has populated the slot-node mapping table.

#### error

This client will emit the error event if there is an error with the cluster library.

#### redis\_error

Error events emitted from the node\_redis library.

### cluster.createClient(port, host, options, [callback])

Create a new cluster instance. It will connect to the specified redis node and discover the rest of the nodes from there.

* `port` - defaults to `6379`
* `host` - defaults to `127.0.0.1`
* `options` - same as node\_redis client options

### cluster.Cluster(nodes, redisOptions, callback)

Create a new cluster instance. It will connect to the first available redis node and discover the rest of the nodes from there.

* `nodes` - an array of objects with `host` and `port` properties.
* `redisOptions` - node\_redis client options. See [node\_redis](https://github.com/mranney/node_redis) documentation.

### client.getSlot(key)

Returns the slot which will be used for a key.

### client.getConenctionBySlot(slot, callback)

Get the node\_redis instance for a specific slot.
