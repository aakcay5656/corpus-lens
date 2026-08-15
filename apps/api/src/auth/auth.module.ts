import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";

import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { TokenService } from "./token.service";

/**
 * `JwtModule.register({})` takes no secret: every sign and verify call passes its own,
 * because there are two of them. A module-level default would make it easy to sign a
 * refresh token with the access secret by omission, and the whole reason the two keys
 * differ is to stop one token being replayed as the other.
 */
@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, TokenService],
  exports: [TokenService],
})
export class AuthModule {}
