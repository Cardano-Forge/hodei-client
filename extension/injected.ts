import { initialize } from "../src/lib";
import { getFailureReason } from "../src/utils";

try {
  initialize({ debug: true });
} catch (error) {
  console.log("failed to initialize hodei client:", getFailureReason(error));
}
