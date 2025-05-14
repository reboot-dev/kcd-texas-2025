import { Application } from "@reboot-dev/reboot";
import { Bank } from "../../api/bank/v1/bank_rbt.js";
import { AccountServicer } from "./account_servicer.js";
import { BankServicer } from "./bank_servicer.js";

const SINGLETON_BANK_ID = "reboot-bank";

const initialize = async (context) => {
  // Perform a sign up to ensure that the bank has been implicitly
  // constructed.
  await Bank.idempotently().create(context, SINGLETON_BANK_ID);
};

new Application({
  servicers: [BankServicer, AccountServicer],
  initialize,
}).run();
