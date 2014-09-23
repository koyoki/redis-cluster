#### 0.6.0

* Add `clusterConfig` event to signal cluster configuration changes
* Add `error` event emitted when no nodes are found in the cluster
* Add a change log
* Fix  old cluster nodes being kept in the node list after a configuration change

#### 0.5.1

* Remove hiredis dependency

#### 0.5.0

* Update to latest node_redis package
* Use `cluster slots` command to generate slot-node mapping table
