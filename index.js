const express = require("express");
const fs = require("fs");
const app = express();
app.use(express.json());

// Load rebuttal strategy data
const rebuttalData = JSON.parse(fs.readFileSync("./mock-data/rebuttalStrategies.json"));

app.post("/rebuttal/strategy", (req, res) => {
  const { network, reasonCode } = req.body;
  const normalizedNetwork = network?.toLowerCase();
  const code = reasonCode?.toUpperCase();

  const data = rebuttalData?.[normalizedNetwork]?.[code];

  if (!data) {
    return res.status(404).json({ message: "No rebuttal strategy found for that reason code." });
  }

  res.json(data);
});

app.get("/", (req, res) => {
  res.send("DisputeGPT Rebuttal Strategy API is live 🚀");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Rebuttal strategy API running at http://localhost:${PORT}`);
});
