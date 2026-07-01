import commonjs from "@rollup/plugin-commonjs";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";

const sdPlugin = "com.este.snapture.sdPlugin";

export default {
    input: "src/plugin.ts",
    output: {
        file: `${sdPlugin}/bin/plugin.js`,
        format: "es",
        sourcemap: false,
    },
    plugins: [
        typescript({ tsconfig: "./tsconfig.json" }),
        nodeResolve({ browser: false, exportConditions: ["node"], preferBuiltins: true }),
        commonjs(),
    ],
};
