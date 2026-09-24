import express from 'express';

const router = express.Router();

router.post("/start-ethercat", (req, res) => {
    exec("sudo /etc/init.d/ethercat start", (error, stdout, stderr) => {
        if (error) return res.status(500).send(error.message);
        if (stderr) return res.status(500).send(stderr);
        res.send(`Started EtherCAT:\n${stdout}`);
    });
});

router.post("/stop-ethercat", (req, res) => {
  exec("sudo /etc/init.d/ethercat stop", (error, stdout, stderr) => {
    if (error) return res.status(500).send(error.message);
    if (stderr) return res.status(500).send(stderr);
    res.send(`Stopped EtherCAT:\n${stdout}`);
  });
});

export default router;