# Generated by Django 4.0.1 on 2022-05-08 19:32

import django.contrib.postgres.fields
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('ticketsystem', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='event',
            name='days',
            field=django.contrib.postgres.fields.ArrayField(base_field=models.DateTimeField(), null=True, size=None),
        ),
    ]
