import Kafka from "node-rdkafka";
import cluster from "cluster";
import os from "os";
import dotenv from "dotenv";
import { randomBytes } from "crypto";
dotenv.config();

const numCPUs = os.cpus().length;
// we will be using one cpu core for active streams
// the remaining cores will be assigned a letter
let alphabet = "abcdefghijklmnopqrstuvwxyz".toUpperCase().split("");

// Only use the number of cores - 1 for the letter array (one is for active streams)
const letterArray = alphabet.slice(0, numCPUs - 1);

if (cluster.isPrimary) {
  console.log(`!Master ${process.pid} Setup Report! CPU Number: ${numCPUs}`);
  console.log(`Ob Names:`, letterArray);
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }
  cluster.on("exit", (worker, code, signal) => {
    console.log(
      `worker ${worker.process.pid} died with code/signal ${
        signal || code
      }. Restarting worker...`
    );
    cluster.fork();
  });
} else {
  //  Config options can be found : https://github.com/confluentinc/librdkafka/blob/v2.0.2/CONFIGURATION.md
  const config = {
    "bootstrap.servers": process.env.BOOTSTRAP_SERVERS,
    "security.protocol": "SASL_SSL",
    "sasl.mechanisms": "PLAIN",
    "sasl.username": process.env.API_KEY,
    "sasl.password": process.env.API_SECRET,
    "session.timeout.ms": "45000",
    "group.id": process.env.GROUP_ID,
    "fetch.min.bytes": 1,
    "message.max.bytes": 1024 * 1024,
    "fetch.wait.max.ms": 100,
    "metadata.max.age.ms": 1,
  };

  const producer = new Kafka.Producer(config);
  let workerId = cluster.worker.id - 1;
  //  if worker id is 0, then we do active streams and assign the rest of the workers to the letter array
  if (workerId === 0) {
    var topic = process.env.TOPIC_ACTIVE;
    //  do active streams
    producer.connect();
    console.log(
      "Active Streams on Worker-" +
        workerId +
        " sending data to " +
        topic +
        "......"
    );

    let allSpreads = [];
    // Get all pairs of the letter array
    for (let i = 0; i < letterArray.length; i++) {
      for (let j = 0; j < letterArray.length; j++) {
        if (i !== j) {
          allSpreads.push(letterArray[i] + "_" + letterArray[j]);
        }
      }
    }

    const generateRandomTrigger = () => {
      // choose a random spread
      let randomIndex = Math.floor(Math.random() * allSpreads.length);
      let randomSpread = allSpreads[randomIndex];
      // choose randomly between true and false
      let randomTrigger = Math.random() >= 0.5;
      return {
        spread: randomSpread,
        asset_one: randomSpread.split("_")[0],
        asset_two: randomSpread.split("_")[1],
        trigger: randomTrigger,
      };
    };

    producer.on("ready", () => {
      //  set interval to send data to kafka
      setInterval(() => {
        let randomTrigger = generateRandomTrigger();
        producer.produce(
          topic,
          -1,
          Buffer.from(JSON.stringify(randomTrigger)),
          Buffer.from(randomTrigger.spread)
        );
      }, 1000);
    });
  } else {
    //  OB stream worker
    var topic = process.env.TOPIC_OB;
    let worker_asset = letterArray[workerId - 1];

    const generateFakeOrderbook = () => {
      // Need to generate a fake orderbook for this asset
      // generate random hex string as the value
      let valueHex = randomBytes(6).toString("hex").toUpperCase();
      const orderbook = {
        asset: worker_asset,
        value: valueHex,
      };
      return orderbook;
    };

    producer.connect();
    console.log(
      "OB Streams " +
        worker_asset +
        " on Worker-" +
        workerId +
        " sending data to " +
        topic +
        "......"
    );
    producer.on("ready", () => {
      //  set interval to send data to kafka
      let randomOrderbook = generateFakeOrderbook();
      setInterval(() => {
        producer.produce(
          topic,
          -1,
          Buffer.from(JSON.stringify(randomOrderbook)),
          Buffer.from(worker_asset)
        );
      }, 1000);
    });
  }
}
