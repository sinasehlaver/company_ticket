# Generated by Django 4.0.1 on 2022-05-10 18:11

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('ticketsystem', '0006_ticket'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='ticket',
            name='day',
        ),
        migrations.DeleteModel(
            name='Day',
        ),
    ]