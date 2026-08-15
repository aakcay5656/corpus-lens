import { Module } from "@nestjs/common";

import { QueryLogService } from "./query-log.service";
import { SearchController } from "./search.controller";
import { SearchService } from "./search.service";

@Module({
  controllers: [SearchController],
  providers: [SearchService, QueryLogService],
})
export class SearchModule {}
