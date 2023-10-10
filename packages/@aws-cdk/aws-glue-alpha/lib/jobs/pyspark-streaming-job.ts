/**
 *  Python Spark Streaming Jobs class
 *
 * A Streaming job is similar to an ETL job, except that it performs ETL on data streams
 * using the Apache Spark Structured Streaming framework.
 * These jobs will default to use Python 3.9.
 *
 * Similar to ETL jobs, streaming job supports Scala and Python languages. Similar to ETL,
 * it supports G1 and G2 worker type and 2.0, 3.0 and 4.0 version. We’ll default to G2 worker
 * and 4.0 version for streaming jobs which developers can override.
 * We will enable —enable-metrics, —enable-spark-ui, —enable-continuous-cloudwatch-log.
 *
 * RFC : https://github.com/aws/aws-cdk-rfcs/blob/main/text/0497-glue-l2-construct.md
 */

import { CfnJob } from 'aws-cdk-lib/aws-glue';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { Job, JobProperties } from './job';
import { Construct } from 'constructs';
import { JobType, GlueVersion, JobLanguage, PythonVersion, WorkerType } from '../constants';
import { SparkUIProps, SparkUILoggingLocation, validateSparkUiPrefix, cleanSparkUiPrefixForGrant } from './spark-ui';

/**
 * Properties for creating a Python Spark ETL job
 */
export interface PySparkStreamingJobProperties extends JobProperties {

  /**
   * Enables the Spark UI debugging and monitoring with the specified props.
   *
   * @default - Spark UI debugging and monitoring is disabled.
   *
   * @see https://docs.aws.amazon.com/glue/latest/dg/monitor-spark-ui-jobs.html
   * @see https://docs.aws.amazon.com/glue/latest/dg/aws-glue-programming-etl-glue-arguments.html
   */
  readonly sparkUI?: SparkUIProps;

  /**
   * Extra Python Files S3 URL (optional)
   * S3 URL where additional python dependencies are located
  */
  readonly extraPythonFiles?: string[];
}

/**
 * A Python Spark Streaming Glue Job
 */
export class pySparkStreamingJob extends Job {

  // Implement abstract Job attributes
  public readonly jobArn: string;
  public readonly jobName: string;
  public readonly role: iam.IRole;
  public readonly grantPrincipal: iam.IPrincipal;

  /**
   * The Spark UI logs location if Spark UI monitoring and debugging is enabled.
   *
   * @see https://docs.aws.amazon.com/glue/latest/dg/monitor-spark-ui-jobs.html
   * @see https://docs.aws.amazon.com/glue/latest/dg/aws-glue-programming-etl-glue-arguments.html
   */
  public readonly sparkUILoggingLocation?: SparkUILoggingLocation;

  /**
   * pySparkStreamingJob constructor
   *
   * @param scope
   * @param id
   * @param props
   */
  constructor(scope: Construct, id: string, props: PySparkStreamingJobProperties) {
    super(scope, id, {
      physicalName: props.jobName,
    });

    // Set up role and permissions for principal
    this.role = props.role, {
      assumedBy: new iam.ServicePrincipal('glue.amazonaws.com'),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSGlueServiceRole')],
    };
    this.grantPrincipal = this.role;

    // Enable SparkUI by default as a best practice
    const sparkUIArgs = props.sparkUI?.bucket ? this.setupSparkUI(this.role, props.sparkUI) : undefined;
    this.sparkUILoggingLocation = sparkUIArgs?.location;

    // Enable CloudWatch metrics and continuous logging by default as a best practice
    const continuousLoggingArgs = props.continuousLogging?.enabled ? this.setupContinuousLogging(this.role, props.continuousLogging) : {};
    const profilingMetricsArgs = { '--enable-metrics': '' };

    // Gather executable arguments
    const executableArgs = this.executableArguments(props);

    // Conbine command line arguments into a single line item
    const defaultArguments = {
      ...executableArgs,
      ...continuousLoggingArgs,
      ...profilingMetricsArgs,
      ...sparkUIArgs?.args,
      ...this.checkNoReservedArgs(props.defaultArguments),
    };

    if ((!props.workerType && props.numberOrWorkers !== undefined) || (props.workerType && props.numberOrWorkers === undefined)) {
      throw new Error('Both workerType and numberOrWorkers must be set');
    }

    const jobResource = new CfnJob(this, 'Resource', {
      name: props.jobName,
      description: props.description,
      role: this.role.roleArn,
      command: {
        name: JobType.STREAMING,
        scriptLocation: this.codeS3ObjectUrl(props.script),
        pythonVersion: PythonVersion.THREE_NINE,
      },
      glueVersion: props.glueVersion ? props.glueVersion : GlueVersion.V4_0,
      workerType: props.workerType ? props.workerType : WorkerType.G_2X,
      numberOfWorkers: props.numberOrWorkers,
      maxRetries: props.maxRetries,
      executionProperty: props.maxConcurrentRuns ? { maxConcurrentRuns: props.maxConcurrentRuns } : undefined,
      timeout: props.timeout?.toMinutes(),
      connections: props.connections ? { connections: props.connections.map((connection) => connection.connectionName) } : undefined,
      securityConfiguration: props.securityConfiguration?.securityConfigurationName,
      tags: props.tags,
      defaultArguments,
    });

    const resourceName = this.getResourceNameAttribute(jobResource.ref);
    this.jobArn = this.buildJobArn(this, resourceName);
    this.jobName = resourceName;
  }

  /**
   * Set the executable arguments with best practices enabled by default
   *
   * @param props
   * @returns An array of arguments for Glue to use on execution
   */
  private executableArguments(props: PySparkStreamingJobProperties) {
    const args: { [key: string]: string } = {};
    args['--job-language'] = JobLanguage.PYTHON;

    // TODO: Confirm with Glue service team what the mapping is from extra-x to job language, if any
    if (props.extraPythonFiles && props.extraPythonFiles.length > 0) {
      //args['--extra-py-files'] = props.extraPythonFiles.map(code => this.codeS3ObjectUrl(code)).join(',');
    }

    // if (props.extraJars && props.extraJars?.length > 0) {
    //   args['--extra-jars'] = props.extraJars.map(code => this.codeS3ObjectUrl(code)).join(',');
    // }
    // if (props.extraFiles && props.extraFiles.length > 0) {
    //   args['--extra-files'] = props.extraFiles.map(code => this.codeS3ObjectUrl(code)).join(',');
    // }
    // if (props.extraJarsFirst) {
    //   args['--user-jars-first'] = 'true';
    // }

    return args;
  }

  private setupSparkUI(role: iam.IRole, sparkUiProps: SparkUIProps) {

    validateSparkUiPrefix(sparkUiProps.prefix);
    const bucket = sparkUiProps.bucket ?? new Bucket(this, 'SparkUIBucket');
    bucket.grantReadWrite(role, cleanSparkUiPrefixForGrant(sparkUiProps.prefix));
    const args = {
      '--enable-spark-ui': 'true',
      '--spark-event-logs-path': bucket.s3UrlForObject(sparkUiProps.prefix),
    };

    return {
      location: {
        prefix: sparkUiProps.prefix,
        bucket,
      },
      args,
    };
  }
}