import { PartialMessage } from "@bufbuild/protobuf";
import { ReaderContext, TransactionContext, allow } from "@reboot-dev/reboot";
import { Account } from "../../api/bank/v1/account_rbt.js";
import {
  AccountBalancesRequest,
  AccountBalancesResponse,
  CreateRequest,
  CreateResponse,
  DepositToAccountRequest,
  DepositToAccountResponse,
  SignUpRequest,
  SignUpResponse,
  TransferRequest,
  TransferResponse,
} from "../../api/bank/v1/bank_pb.js";
import { Bank } from "../../api/bank/v1/bank_rbt.js";

function randomIntFromInterval(min: number, max: number): number {
  // Min / max inclusive.
  return Math.floor(Math.random() * (max - min + 1) + min);
}

export class BankServicer extends Bank.Servicer {
  authorizer() {
    return allow();
  }

  async PickNewAccountId(state: Bank.State): Promise<string> {
    // Transactions normally observe state through Reader calls. However for
    // convenience, it is possible to do an inline read of the state of this
    // state machine, which is like calling a Reader that simply returns the
    // whole state of the state machine.

    while (true) {
      const newAccountId = String(randomIntFromInterval(1000000, 9999999));
      if (!state.accountIds.includes(newAccountId)) {
        return newAccountId;
      }
    }
  }

  async depositToAccount(
    context: TransactionContext,
    state: Bank.State,
    request: DepositToAccountRequest
  ): Promise<PartialMessage<DepositToAccountResponse>> {
    const { accountId, amount } = request;

    const account = Account.ref(accountId);
    await account.deposit(context, {
      amount: amount,
    });

    return {};
  }

  async create(
    context: TransactionContext,
    state: Bank.State,
    request: CreateRequest
  ): Promise<PartialMessage<CreateResponse>> {
    // This is a constructor, so we are setting the initial state of the
    // state machine.
    state.accountIds = [];
    return {};
  }

  async accountBalances(
    context: ReaderContext,
    state: Bank.State,
    request: AccountBalancesRequest
  ): Promise<PartialMessage<AccountBalancesResponse>> {
    const accountIds = state.accountIds;

    const balances = await Promise.all(
      accountIds.map(async (accountId) => {
        const balance = await Account.ref(accountId).balance(context);

        return { accountId, balance: Number(balance.amount) };
      })
    );

    return { balances };
  }

  async signUp(
    context: TransactionContext,
    state: Bank.State,
    request: SignUpRequest
  ): Promise<PartialMessage<SignUpResponse>> {
    const accountId = request.accountId;

    // Transactions like writers can alter state directly.
    state.accountIds.push(accountId);

    // Let's go create the account.
    const [account, response] = await Account.open(context, accountId, {});

    await account.deposit(context, {
      amount: request.initialDeposit,
    });

    return { accountId: accountId };
  }

  async transfer(
    context: TransactionContext,
    state: Bank.State,
    request: TransferRequest
  ): Promise<PartialMessage<TransferResponse>> {
    const fromAccount = Account.ref(request.fromAccountId);
    const toAccount = Account.ref(request.toAccountId);

    await fromAccount.withdraw(context, { amount: request.amount });
    await toAccount.deposit(context, { amount: request.amount });

    return {};
  }
}
