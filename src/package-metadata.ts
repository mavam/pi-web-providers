import packageJson from "../package.json" with { type: "json" };

export const PACKAGE_NAME = packageJson.name;
export const PACKAGE_VERSION = packageJson.version;
export const CONFIG_SCHEMA_URL = `https://unpkg.com/${PACKAGE_NAME}@${PACKAGE_VERSION}/dist/config.schema.json`;
