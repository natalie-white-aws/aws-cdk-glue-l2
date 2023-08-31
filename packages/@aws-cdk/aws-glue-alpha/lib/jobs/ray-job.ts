import { CfnJob } from 'aws-cdk-lib/aws-glue';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Job, JobProperties } from './job';
import { Construct } from 'constructs';
import { JobType, GlueVersion, JobLanguage, WorkerType } from '../constants';

/**
 * Ray Jobs class
 *
 * Glue ray only supports worker type Z.2X and Glue version 4.0.
 * Runtime will default to Ray2.3 and min workers will default to 3.
 *
 */

/**
 * Properties for creating a Ray Glue job
 */
export interface RayJobProperties extends JobProperties {}

/**
 * A Ray Glue Job
 */
export class RayJob extends Job {

  // Implement abstract Job attributes
  public readonly jobArn: string;
  public readonly jobName: string;
  public readonly role: iam.IRole;
  public readonly grantPrincipal: iam.IPrincipal;

  /**
   * RayJob constructor
   *
   * @param scope
   * @param id
   * @param props
   */

  constructor(scope: Construct, id: string, props: RayJobProperties) {
    super(scope, id, {
      physicalName: props.jobName,
    });

    // Set up role and permissions for principal
    this.role = props.role, {
      assumedBy: new iam.ServicePrincipal('glue.amazonaws.com'),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSGlueServiceRole')],
    };
    this.grantPrincipal = this.role;

    // Conbine command line arguments into a single line item
    const defaultArguments = {
      ...this.checkNoReservedArgs(props.defaultArguments),
    };

    

  }




}