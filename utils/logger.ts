import winston, { format, transports, Logger } from "winston";
import fs from "fs";
import path from "path";

// Create a logs directory if it doesn't exist
const logDir = path.resolve(__dirname, "../logs");
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// Generate a unique log file for each session (run)
const sessionLogFile = path.join(logDir, `session-${Date.now()}.json`);

const logger: Logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: format.combine(format.timestamp(), format.json()),
  defaultMeta: { service: "user-service" },
  transports: [
    // new transports.File({
    //   filename: path.join(logDir, "error.log"),
    //   level: "error",
    // }),
    // new transports.File({ filename: path.join(logDir, "combined.log") }),
    // new transports.Console(),
    new transports.File({ filename: sessionLogFile }), // Session-specific log file
  ],
});

//
// If we're not in production then log to the `console` with the format:
// `${info.level}: ${info.message} JSON.stringify({ ...rest }) `
//
// if (process.env.NODE_ENV !== "production") {
//   logger.add(
//     new transports.Console({
//       format: format.simple(),
//     })
//   );
// }
export { logger };
