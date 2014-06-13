/* global describe, beforeEach, afterEach, it */
var expect = require("expect.js");
var cluster = require("../index.js");

var host = process.env.HOST;
var port = process.env.PORT;
var nodes = [
    {"host": host, "port": port},
];

var redisOptions = {
    "max_attempts": 1
};

describe("Cluster", function () {
    it("should return error if there are no cluster nodes", function (done) {
        var c = cluster.createClient(null, null, redisOptions);
        c.once("error", function (err) {
            expect(err).to.be.an(Error);
            done();
        });
    });

    it("should handle key hash tags correctly", function () {
        var slot = cluster.getSlot("123456789");

        expect(cluster.getSlot("{123456789}test")).to.be(slot);
        expect(cluster.getSlot("test{123456789}")).to.be(slot);
        expect(cluster.getSlot("test{123456789}test{abc}")).to.be(slot);

        expect(cluster.getSlot("{}123456789")).not.to.be(slot);
    });

    it("should connect to a cluster with node_redis interface", function (done) {
        var c = cluster.createClient(port, host, redisOptions);
        c.once("ready", function () {
            done();
        });
    });

    it("should connect to a cluster", function (done) {
        var c = new cluster.Cluster(nodes, redisOptions);
        c.once("ready", function () {
            done();
        });
    });
});

describe("Redis Commands", function () {
    var c;
    beforeEach(function (done) {
        c = new cluster.Cluster(nodes, redisOptions);
        c.once("ready", done);
    });

    describe("single-key", function () {
        afterEach(function (done) {
            c.DEL("foo", function () {
                done();
            });
        });

        it("should set and get strings", function (done) {
            c.SET("foo", "bar", function (err, res) {
                expect(err).to.be(null);
                expect(res).to.be("OK");

                c.sendClusterCommand("GET", "foo", function (err, res) {
                    expect(err).to.be(null);
                    expect(res).to.be("bar");
                    done();
                });
            });
        });

        it("should set and get hashes", function (done) {
            c.sendClusterCommand("HSET", "foo", "bar", "val", function (err, res) {
                expect(err).to.be(null);
                expect(res).to.be(1);

                c.sendClusterCommand("HGET", "foo", "bar", function (err, res) {
                    expect(err).to.be(null);
                    expect(res).to.be("val");

                    c.sendClusterCommand("HDEL", "foo", "bar", function (err, res) {
                        expect(err).to.be(null);
                        expect(res).to.be(1);

                        c.sendClusterCommand("HGET", "foo", "bar", function (err, res) {
                            expect(err).to.be(null);
                            expect(res).to.be(null);
                            done();
                        });
                    });
                });
            });
        });
    });

    describe("multi-key", function () {
        it("should set multiple keys", function (done) {
            var multi = c.multi();
            multi.SET("{foo}1", "bar1");
            multi.SET("{foo}2", "bar2");
            multi.GET("{foo}1");
            multi.GET("{foo}2");
            multi.DEL("{foo}1");
            multi.DEL("{foo}2");
            multi.exec(function (err, res) {
                expect(err).to.be(null);
                expect(res).to.be.an("array");
                expect(res[2]).to.be("bar1");
                expect(res[3]).to.be("bar2");
                done();
            });
        });

        it("should not exec if slots don't match", function (done) {
            var multi = c.multi();
            multi.SET("foo1", "bar");
            multi.SET("foo2", "bar");
            multi.exec(function (err, res) {
                expect(err).to.be.an(Error);
                expect(res).to.be(undefined);
                done();
            });
        });
    });
});
