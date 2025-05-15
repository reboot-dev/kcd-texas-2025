import { PartialMessage } from "@bufbuild/protobuf";
import { ReaderContext, WriterContext, allow } from "@reboot-dev/reboot";
import {
  BalanceRequest,
  BalanceResponse,
  DepositRequest,
  DepositResponse,
  InterestRequest,
  InterestResponse,
  OpenRequest,
  OpenResponse,
  WelcomeEmailRequest,
  WelcomeEmailResponse,
  WithdrawRequest,
  WithdrawResponse,
} from "../../api/bank/v1/account_pb.js";
import { Account } from "../../api/bank/v1/account_rbt.js";
import { OverdraftError } from "../../api/bank/v1/errors_pb.js";

export class AccountServicer extends Account.Servicer {
  authorizer() {
    return allow();
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

  async balance(
    _context: ReaderContext,
    state: Account.State,
    request: BalanceRequest
  ): Promise<PartialMessage<BalanceResponse>> {
    return { amount: Number(state.balance) };
  }

  async deposit(
    context: WriterContext,
    state: Account.State,
    request: DepositRequest
  ): Promise<PartialMessage<DepositResponse>> {
    console.log("Deposit on the backend!", request.amount);
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

  async interest(
    context: WriterContext,
    state: Account.State,
    request: InterestRequest
  ): Promise<PartialMessage<InterestResponse>> {
    state.balance += BigInt(1);

    const now = new Date();
    // 0-4 seconds from now
    const when = new Date(now.getTime() + Math.floor(Math.random() * 4) * 1000);

    await this.ref().schedule({ when }).interest(context);

    return {};
  }

  async welcomeEmail(
    context: WriterContext,
    state: Account.State,
    request: WelcomeEmailRequest
  ): Promise<PartialMessage<WelcomeEmailResponse>> {
    const messageBody = `
      Hello ${state.name},

      We are delighted to welcome you as a customer.
      Your new account has been opened, and has ID '${context.stateId}'.

      Best regards,
      Your Bank
    `;

    await sendEmail({ messageBody });

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
