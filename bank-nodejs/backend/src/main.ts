import { Application, Loop, until, WorkflowContext } from "@reboot-dev/reboot";
import { PartialMessage } from "@bufbuild/protobuf";
import {
  ReaderContext,
  TransactionContext,
  WriterContext,
  allow,
} from "@reboot-dev/reboot";
import {
  Account,
  AccountBalancesRequest,
  AccountBalancesResponse,
  Bank,
  CreateRequest,
  CreateResponse,
  SignUpRequest,
  SignUpResponse,
  TransferRequest,
  TransferResponse,
  BalanceRequest,
  BalanceResponse,
  DepositRequest,
  DepositResponse,
  InterestRequest,
  OpenRequest,
  OpenResponse,
  OverdraftError,
  WithdrawRequest,
  WithdrawResponse,
  UpgradeOfferWorkflowRequest,
  UpgradeOfferWorkflowResponse,
} from "../../api/bank/v1/bank_rbt.js";
import sortedMap, {
  SortedMap,
} from "@reboot-dev/reboot-std/collections/sorted_map.js";
import { v4 as uuidv4 } from "uuid";

const SINGLETON_BANK_ID = "reboot-bank";

function randomIntFromInterval(min: number, max: number): number {
  // Min / max inclusive.
  return Math.floor(Math.random() * (max - min + 1) + min);
}

export class AccountServicer extends Account.Servicer {
  authorizer() {
    return allow();
  }

  async balance(
    context: ReaderContext,
    state: Account.State,
    request: BalanceRequest
  ): Promise<PartialMessage<BalanceResponse>> {
    return { amount: state.balance };
  }

  async deposit(
    context: WriterContext,
    state: Account.State,
    request: DepositRequest
  ): Promise<PartialMessage<DepositResponse>> {
    state.balance += request.amount;

    return {};
  }

  async withdraw(
    context: WriterContext,
    state: Account.State,
    request: WithdrawRequest
  ): Promise<PartialMessage<WithdrawResponse>> {
    const updatedBalance = state.balance - request.amount;
    if (updatedBalance < 0) {
      throw new Account.WithdrawAborted(
        new OverdraftError({
          amount: Number(-updatedBalance),
        })
      );
    }

    state.balance = updatedBalance;

    return {};
  }

  async open(
    context: WriterContext,
    state: Account.State,
    request: OpenRequest
  ): Promise<PartialMessage<OpenResponse>> {
    // Since this is a constructor, we are setting the initial state of the
    // state machine.

    // We'd like to send the new customer a welcome email, but that can be
    // done asynchronously, so we schedule it as a task.
    // const taskId = await this.ref().schedule().welcomeEmail(context);
    await this.ref().schedule().interest(context);

    return {};
  }

  async interest(
    context: WorkflowContext,
    request: InterestRequest
  ): Promise<Loop> {
    const now = new Date();
    // 0-4 seconds from now
    const when = new Date(now.getTime() + Math.floor(Math.random() * 4) * 1000);

    const increment = async (state: Account.State) => {
      state.balance += 1;
      return;
    };

    await this.state.write(
      `Increment each iterattion ${context.iteration}`,
      context,
      increment
    );

    return new Loop({ when });
  }

  // async welcomeEmail(
  //   context: WriterContext,
  //   state: Account.State,
  //   request: WelcomeEmailRequest
  // ): Promise<PartialMessage<WelcomeEmailResponse>> {
  //   const messageBody = `
  //     Hello ${state.name},

  //     We are delighted to welcome you as a customer.
  //     Your new account has been opened, and has ID '${context.stateId}'.

  //     Best regards,
  //     Your Bank
  //   `;

  //   await sendEmail({ messageBody });

  //   return {};
  // }
}

export class BankServicer extends Bank.Servicer {
  authorizer() {
    return allow();
  }

  // async PickNewAccountId(state: Bank.State): Promise<string> {
  //   // Transactions normally observe state through Reader calls. However for
  //   // convenience, it is possible to do an inline read of the state of this
  //   // state machine, which is like calling a Reader that simply returns the
  //   // whole state of the state machine.

  //   while (true) {
  //     const newAccountId = String(randomIntFromInterval(1000000, 9999999));
  //     if (!state.accountIds.includes(newAccountId)) {
  //       return newAccountId;
  //     }
  //   }
  // }

  // async depositToAccount(
  //   context: TransactionContext,
  //   state: Bank.State,
  //   request: DepositToAccountRequest
  // ): Promise<PartialMessage<DepositToAccountResponse>> {
  //   const { accountId, amount } = request;

  //   const account = Account.ref(accountId);
  //   await account.deposit(context, {
  //     amount: amount,
  //   });

  //   return {};
  // }

  async create(
    context: TransactionContext,
    state: Bank.State,
    request: CreateRequest
  ): Promise<PartialMessage<CreateResponse>> {
    state.accountIdsMapId = uuidv4();

    await SortedMap.ref(state.accountIdsMapId).insert(context, { entries: {} });

    return {};
  }

  async accountBalances(
    context: ReaderContext,
    state: Bank.State,
    request: AccountBalancesRequest
  ): Promise<PartialMessage<AccountBalancesResponse>> {
    // Get the first "page" of account IDs (32 entries).
    const accountIdsMap = SortedMap.ref(state.accountIdsMapId);
    const accountIds = await accountIdsMap.range(context, { limit: 32 });

    const balances = await Promise.all(
      accountIds.entries.map(async (entry) => {
        const balance = await Account.ref(
          new TextDecoder().decode(entry.value)
        ).balance(context);

        return {
          accountId: new TextDecoder().decode(entry.value),
          balance: balance.amount,
        };
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

    const [account, response] = await Account.open(context, accountId, {});

    await account.deposit(context, {
      amount: request.initialDeposit,
    });

    await SortedMap.ref(state.accountIdsMapId).insert(context, {
      entries: {
        [uuidv4()]: new TextEncoder().encode(accountId),
      },
    });

    await this.ref().schedule().upgradeOfferWorkflow(context, {
      accountId,
    });

    return {};
  }

  async transfer(
    context: TransactionContext,
    state: Bank.State,
    request: TransferRequest
  ): Promise<PartialMessage<TransferResponse>> {
    const fromAccount = Account.ref(request.fromAccountId);
    const toAccount = Account.ref(request.toAccountId);

    await Promise.all([
      await fromAccount.withdraw(context, { amount: request.amount }),
      await toAccount.deposit(context, { amount: request.amount }),
    ]);

    return {};
  }

  async upgradeOfferWorkflow(
    context: WorkflowContext,
    request: UpgradeOfferWorkflowRequest
  ): Promise<PartialMessage<UpgradeOfferWorkflowResponse>> {
    const largeBalance = async () => {
      const account = Account.ref(request.accountId);
      const balance = await account.balance(context);
      return balance.amount > 1000;
    };

    await until("Large balance", context, largeBalance);

    // TODO: email the offer!

    console.log(
      "**************\n",
      `Account ${request.accountId} has sufficient balance for upgrade!`,
      "**************\n"
    );

    return {};
  }
}

const sendEmail = ({ messageBody }: { messageBody: string }) => {
  // We're not actually going to send an email here; but you could!
  //
  // If you do send real emails, please be sure to use an idempotent API, since
  // (like in any well-written distributed system) this call may be retried in
  // case of errors.
  console.log(`
    Sending email:

    ${messageBody}
  `);
};

const initialize = async (context) => {
  // Perform a sign up to ensure that the bank has been implicitly
  // constructed.
  await Bank.idempotently().create(context, SINGLETON_BANK_ID);
};

new Application({
  servicers: [...sortedMap.servicers(), BankServicer, AccountServicer],
  initialize,
}).run();
