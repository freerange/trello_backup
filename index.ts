import cdk = require('@aws-cdk/cdk');
import lambda = require('@aws-cdk/aws-lambda');
import events = require('@aws-cdk/aws-events');
import s3 = require('@aws-cdk/aws-s3');
import { Topic } from '@aws-cdk/aws-sns';
import dotenv = require('dotenv');

dotenv.config();

const rubyLambdaRuntime = new lambda.Runtime('ruby2.5');
const lambdaFunctionTimeout = 30;

class TrelloBackupStack extends cdk.Stack {
  constructor(parent: cdk.App, id: string, props?: cdk.StackProps) {
    super(parent, id, props);

    const monitoringTopic = new Topic(this, 'monitoringTopic');
    const backupBoardTopic = new Topic(this, 'backupBoardTopic');

    const enumerateBoardsFunction
      = this.createEnumerateBoardsFunction(backupBoardTopic, monitoringTopic);

    const bucketName = process.env.TRELLO_BACKUP_S3_BUCKET_NAME;
    const boardBackupsBucket
      = this.createBoardBackupsBucket(bucketName);

    const backupBoardFunction
      = this.createBackupBoardFunction(boardBackupsBucket, monitoringTopic);

    backupBoardTopic.subscribeLambda(backupBoardFunction);

    const monitoringEmailAddress = process.env.TRELLO_BACKUP_MONITORING_EMAIL_ADDRESS;
    monitoringTopic.subscribeEmail('monitoringTopicEmail', monitoringEmailAddress);

    const scheduleForBackup = process.env.TRELLO_BACKUP_SCHEDULE_FOR_BACKUP;
    const ruleForBackup = new events.EventRule(this, 'RuleForBackup', {
       scheduleExpression: scheduleForBackup,
    });
    ruleForBackup.addTarget(enumerateBoardsFunction);
  }

  createEnumerateBoardsFunction(backupBoardTopic : Topic, monitoringTopic : Topic) : lambda.Function {
    const lambdaFunction = new lambda.Function(this, 'enumerateBoards', {
      runtime: rubyLambdaRuntime,
      handler: 'index.handler',
      code: lambda.Code.asset('./lambdaFunctions/enumerateBoards'),
      environment: {
        TRELLO_BACKUP_BACKUP_BOARD_TOPIC_ARN: backupBoardTopic.topicArn
      },
      timeout: lambdaFunctionTimeout
    });
    backupBoardTopic.grantPublish(lambdaFunction.role);
    this.reportErrors(lambdaFunction, monitoringTopic);
    return lambdaFunction;
  }

  createBoardBackupsBucket(bucketName : string) : s3.Bucket {
    return new s3.Bucket(this, 'boardBackupsBucket', {
      bucketName: bucketName,
      versioned: true
    });
  }

  createBackupBoardFunction(boardBackupsBucket : s3.Bucket, monitoringTopic : Topic) : lambda.Function {
    const lambdaFunction = new lambda.Function(this, 'backupBoard', {
      runtime: rubyLambdaRuntime,
      handler: 'index.handler',
      code: lambda.Code.asset('./lambdaFunctions/backupBoard'),
      timeout: lambdaFunctionTimeout
    });
    boardBackupsBucket.grantPut(lambdaFunction.role);
    this.reportErrors(lambdaFunction, monitoringTopic);
    return lambdaFunction;
  }

  reportErrors(lambdaFunction : lambda.Function, monitoringTopic : Topic) : void {
    const metricErrors = lambdaFunction.metricErrors();
    const alarm = metricErrors.newAlarm(this, `${lambdaFunction.id}Alarm`, {
      threshold: 1,
      evaluationPeriods: 1
    });
    alarm.onAlarm(monitoringTopic);
  }
}

const app = new cdk.App();
new TrelloBackupStack(app, 'TrelloBackup');
app.run();
