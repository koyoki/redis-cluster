# koyoki-redis-cluster

A node\_redis client wrapper to support cluster connections.

## Install

    npm install koyoki-redis-cluster

### Example

```javascript
var nodes = [
    {"host": "node1.domain.com", "port": 10000},
    {"host": "node1.domain.com", "port": 10001},
    {"host": "node2.domain.com", "port": 10000},
    {"host": "node2.domain.com", "port": 10001},
];
var Cluster = require("koyoki-redis-cluster");

var c = new Cluster(nodes, {"max_attempts": 5}, function (err) {
    c.SET("foo", "bar", function () {
        c.GET("foo", "bar", function (err, bar) {
            console.log("foo = " + bar);
        });
    });


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

The cluster instance can be used as a drop-in replacement for the regular node\_redis client.

## API

### Cluster(nodes, redisOptions, callback)

Create a new cluster instance. It will connect to the first available redis node and discover the rest of the nodes from there.

* `nodes` - an array of objects with `host` and `port` properties.
* `redisOptions` - node\_redis client options. See [node\_redis](https://github.com/mranney/node_redis) documentation.
* `callback` - function that takes an err parameter. Called when the instance is connected to the cluster, or cannot connect to any node.

### cluster.getSlot(key)

Returns the slot which will be used for a key.

### cluster.getConenctionBySlot(slot, callback)

Get the node\_redis instance for a specific slot.
