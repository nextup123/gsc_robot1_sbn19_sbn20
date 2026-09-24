const express = require("express");
const path = require("path");

const router = express.Router();

router.get('/', (req, res) => {
    const errorJsonPath = path.join(__dirname, "../user_config/errors/errors.json");
    
    res.sendFile(errorJsonPath);
});



module.exports = router;
