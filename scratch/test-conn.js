const mysql = require("mysql2/promise");

async function tryConnect() {
  try {
    const config = {
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT || "4000"),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      ssl: {
        minVersion: "TLSv1.2",
        rejectUnauthorized: true,
      },
      allowPublicKeyRetrieval: true,
    };

    console.log("Connecting with allowPublicKeyRetrieval: true...");
    const pool = mysql.createPool(config);
    const connection = await pool.getConnection();
    console.log("SUCCESS connected!");
    connection.release();
    await pool.end();
    return true;
  } catch (error) {
    console.log("FAILED. Error:", error.message);
    return false;
  }
}

tryConnect();
